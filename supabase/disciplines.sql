-- Add persistent project discipline categories.
-- Run once on an existing portfolio project.

create table if not exists public.portfolio_disciplines (
  id uuid primary key default gen_random_uuid(),
  name text not null unique check (char_length(trim(name)) between 1 and 40),
  sort_order integer not null default 0,
  is_visible boolean not null default true,
  created_at timestamptz not null default now()
);
create unique index if not exists portfolio_disciplines_name_lower_idx
  on public.portfolio_disciplines (lower(name));
alter table public.portfolio_disciplines add column if not exists is_visible boolean not null default true;
alter table public.portfolio_disciplines enable row level security;
revoke all on public.portfolio_disciplines from anon, authenticated;
grant select on public.portfolio_disciplines to anon, authenticated;
grant insert, delete on public.portfolio_disciplines to authenticated;
grant update (is_visible) on public.portfolio_disciplines to authenticated;
drop policy if exists "Public can read portfolio disciplines" on public.portfolio_disciplines;
drop policy if exists "Admins can add portfolio disciplines" on public.portfolio_disciplines;
drop policy if exists "Admins can delete portfolio disciplines" on public.portfolio_disciplines;
drop policy if exists "Admins can update portfolio discipline visibility" on public.portfolio_disciplines;
create policy "Public can read portfolio disciplines"
  on public.portfolio_disciplines for select to anon, authenticated using (true);
create policy "Admins can add portfolio disciplines"
  on public.portfolio_disciplines for insert to authenticated
  with check ((select private.is_portfolio_admin()));
create policy "Admins can delete portfolio disciplines"
  on public.portfolio_disciplines for delete to authenticated
  using ((select private.is_portfolio_admin()));
create policy "Admins can update portfolio discipline visibility"
  on public.portfolio_disciplines for update to authenticated
  using ((select private.is_portfolio_admin()))
  with check ((select private.is_portfolio_admin()));
insert into public.portfolio_disciplines (name, sort_order) values
  ('Illustration',10),('Icon design',20),('Poster',30),
  ('Drawing',40),('3D Design',50),('Painting',60)
on conflict (name) do nothing;
