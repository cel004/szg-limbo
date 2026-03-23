(function (global) {
    var STORAGE_KEY = 'limboAquariumGuests';
    var LEGACY_KEY = 'limboAquariumVisitor';

    var AVATAR_PATH_RE = /^assets\/fish\/fish(10|[1-9])-8\.png$/;

    var EMBEDDED_SUPABASE = {
        url: '',
        anonKey: ''
    };

    function str(v) {
        return typeof v === 'string' ? v.trim() : '';
    }

    function getSupabaseConfig() {
        var c = global.LIMBO_SUPABASE || {};
        var url = str(c.url || c.supabaseUrl || EMBEDDED_SUPABASE.url).replace(/\/$/, '');
        var anonKey = str(c.anonKey || c.anon_key || c.anon || EMBEDDED_SUPABASE.anonKey || EMBEDDED_SUPABASE.anon_key);
        return { url: url, anonKey: anonKey };
    }

    function configured() {
        var cfg = getSupabaseConfig();
        return (
            cfg.url.indexOf('https://') === 0 &&
            cfg.url.indexOf('.supabase.co') !== -1 &&
            cfg.anonKey.length > 35
        );
    }

    function diagnose() {
        var cfg = getSupabaseConfig();
        var reasons = [];
        if (!cfg.url) reasons.push('url is empty (aquarium-config.js missing, 404, or not pushed to hosting)');
        else if (cfg.url.indexOf('https://') !== 0) reasons.push('url must start with https://');
        else if (cfg.url.indexOf('.supabase.co') === -1) reasons.push('url should be https://YOUR_REF.supabase.co');
        if (!cfg.anonKey) reasons.push('anon key is empty');
        else if (cfg.anonKey.length <= 35) reasons.push('anon key looks too short (should be a long eyJ… JWT)');
        return {
            ok: configured(),
            urlLength: cfg.url.length,
            anonKeyLength: cfg.anonKey.length,
            reasons: reasons
        };
    }

    function validGuest(g) {
        return g && typeof g.username === 'string' && typeof g.avatarSrc === 'string';
    }

    function normalizeAvatarSrc(src) {
        if (!src || typeof src !== 'string') return '';
        var s = src.trim();
        var idx = s.indexOf('assets/fish/');
        if (idx !== -1) s = s.slice(idx);
        return s.split('?')[0];
    }

    function loadLocal() {
        try {
            var raw = localStorage.getItem(STORAGE_KEY);
            if (raw) {
                var parsed = JSON.parse(raw);
                if (Array.isArray(parsed)) {
                    return parsed.filter(validGuest);
                }
            }
            var leg = localStorage.getItem(LEGACY_KEY);
            if (leg) {
                var o = JSON.parse(leg);
                if (o && o.username && o.avatarSrc) return [o];
            }
        } catch (e) {}
        return [];
    }

    function persistLocal(guests) {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(guests));
        try {
            localStorage.removeItem(LEGACY_KEY);
        } catch (e) {}
    }

    function mapRow(row) {
        return {
            username: row.username,
            avatarSrc: row.avatar_src,
            leftPct: Number(row.left_pct),
            topPct: Number(row.top_pct)
        };
    }

    function loadRemote() {
        var cfg = getSupabaseConfig();
        var url =
            cfg.url +
            '/rest/v1/aquarium_guests?select=username,avatar_src,left_pct,top_pct&order=created_at.asc';
        return fetch(url, {
            headers: {
                apikey: cfg.anonKey,
                Authorization: 'Bearer ' + cfg.anonKey
            }
        }).then(function (res) {
            if (!res.ok) {
                return res.text().then(function (text) {
                    throw new Error(readSupabaseError(res, text || ''));
                });
            }
            return res.json();
        }).then(function (rows) {
            if (!Array.isArray(rows)) return [];
            return rows.map(mapRow).filter(function (g) {
                return validGuest(g) && AVATAR_PATH_RE.test(g.avatarSrc);
            });
        });
    }

    function assertGuestForWrite(guest) {
        var u = (guest.username || '').trim();
        if (!u || u.length > 64) throw new Error('Invalid username.');
        var avatarPath = normalizeAvatarSrc(guest.avatarSrc || '');
        if (!avatarPath || !AVATAR_PATH_RE.test(avatarPath)) throw new Error('Invalid avatar.');
        var lp = Number(guest.leftPct);
        var tp = Number(guest.topPct);
        if (isNaN(lp) || isNaN(tp) || lp < 0 || lp > 100 || tp < 0 || tp > 100) {
            throw new Error('Invalid position.');
        }
        return {
            username: u,
            avatarSrc: avatarPath,
            leftPct: lp,
            topPct: tp
        };
    }

    function readSupabaseError(res, bodyText) {
        var msg = res.status + ' ' + (res.statusText || '');
        try {
            var j = JSON.parse(bodyText);
            if (j.message) msg = j.message;
            if (j.hint) msg += ' — ' + j.hint;
            if (j.details) msg += ' (' + j.details + ')';
        } catch (e) {
            if (bodyText && bodyText.length) msg += ': ' + bodyText.slice(0, 280);
        }
        return msg;
    }

    function addRemote(guest) {
        var cfg = getSupabaseConfig();
        var g;
        try {
            g = assertGuestForWrite(guest);
        } catch (e) {
            return Promise.reject(e);
        }
        var url = cfg.url + '/rest/v1/aquarium_guests';
        return fetch(url, {
            method: 'POST',
            headers: {
                apikey: cfg.anonKey,
                Authorization: 'Bearer ' + cfg.anonKey,
                'Content-Type': 'application/json',
                Prefer: 'return=minimal'
            },
            body: JSON.stringify({
                username: g.username,
                avatar_src: g.avatarSrc,
                left_pct: g.leftPct,
                top_pct: g.topPct
            })
        }).then(function (res) {
            if (res.ok) return;
            return res.text().then(function (text) {
                var detail = readSupabaseError(res, text || '');
                var hint =
                    res.status === 401
                        ? ' Check the anon key in js/aquarium-config.js.'
                        : res.status === 403 || /permission denied/i.test(detail)
                          ? ' Run the grant lines in supabase-aquarium.sql (anon needs INSERT on the table).'
                          : '';
                throw new Error('Could not save to Supabase: ' + detail + hint);
            });
        });
    }

    function addLocal(guest) {
        var g = assertGuestForWrite(guest);
        var guests = loadLocal();
        guests.push({
            username: g.username,
            avatarSrc: g.avatarSrc,
            leftPct: g.leftPct,
            topPct: g.topPct
        });
        persistLocal(guests);
    }

    global.LimboAquarium = {
        diagnose: diagnose,
        isRemote: function () {
            return configured();
        },
        loadGuests: function () {
            if (configured()) return loadRemote();
            return Promise.resolve(loadLocal());
        },
        addGuest: function (guest) {
            if (configured()) return addRemote(guest);
            try {
                addLocal(guest);
            } catch (e) {
                return Promise.reject(e);
            }
            if (global.console && console.warn) {
                console.warn(
                    '[LimboAquarium] Saved to this browser only. Set url + anonKey in js/aquarium-config.js to use Supabase.'
                );
            }
            return Promise.resolve({ mode: 'local' });
        }
    };
})(typeof window !== 'undefined' ? window : this);