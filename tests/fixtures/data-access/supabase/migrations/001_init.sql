-- Products are public catalogue data.
create table public.products (id bigint primary key, name text, price_cents int);
alter table public.products enable row level security;
create policy "anyone can read products" on public.products for select to anon, authenticated using (true);

-- Orders: RLS forgotten.
create table if not exists orders (id bigint primary key, user_id uuid, total_cents int);

-- Profiles: RLS on, but the update policy lets anyone edit anyone.
create table "public"."profiles" (id uuid primary key, email text);
alter table only public.profiles enable row level security;
create policy "edit profiles" on public.profiles for update to authenticated using (true) with check (true);
create policy "own profile" on public.profiles for select to authenticated using (auth.uid() = id);

-- Audit log turned RLS off "temporarily".
create table public.audit_log (id bigint primary key, event text);
alter table public.audit_log disable row level security;

-- Private schema is not exposed by default.
create table private.secrets (id int);
