-- run this in supabase: dashboard → SQL editor → new query → run
-- https://supabase.com/dashboard

create table if not exists public.aquarium_guests (
  id uuid primary key default gen_random_uuid(),
  username text not null check (char_length(username) between 1 and 64),
  avatar_src text not null check (avatar_src ~ '^assets/fish/fish(10|[1-9])-8\.png$'),
  left_pct double precision not null check (left_pct >= 0 and left_pct <= 100),
  top_pct double precision not null check (top_pct >= 0 and top_pct <= 100),
  created_at timestamptz not null default now()
);

alter table public.aquarium_guests enable row level security;

create policy "aquarium_guests_select_public"
  on public.aquarium_guests for select
  using (true);

create policy "aquarium_guests_insert_public"
  on public.aquarium_guests for insert
  with check (true);

-- Required for the browser (anon key): table privileges are separate from RLS.
grant select, insert on table public.aquarium_guests to anon;
grant select, insert on table public.aquarium_guests to authenticated;

-- reset aquarium (run only this line in SQL editor to remove every guest):
--   truncate table public.aquarium_guests;