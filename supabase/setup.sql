-- Run once in Supabase Dashboard > SQL Editor.
-- Never put a service_role key in the browser.

create schema if not exists private;
create table if not exists public.portfolio_admins (
  user_id uuid primary key references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);
alter table public.portfolio_admins enable row level security;
revoke all on public.portfolio_admins from anon, authenticated;
grant select on public.portfolio_admins to authenticated;
drop policy if exists "Admins can read their own admin record" on public.portfolio_admins;
create policy "Admins can read their own admin record"
  on public.portfolio_admins for select to authenticated
  using ((select auth.uid()) = user_id);

create or replace function private.is_portfolio_admin()
returns boolean language sql stable security definer set search_path = ''
as $$ select exists (select 1 from public.portfolio_admins a where a.user_id = (select auth.uid())); $$;
revoke all on function private.is_portfolio_admin() from public;
grant usage on schema private to anon, authenticated;
grant execute on function private.is_portfolio_admin() to anon, authenticated;

create table if not exists public.projects (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,
  title text not null check (char_length(title) between 1 and 120),
  category text not null,
  year integer not null default extract(year from now())::integer check (year between 1900 and 2200),
  description text not null default '',
  art_key text,
  cover_path text,
  is_published boolean not null default true,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.projects enable row level security;
revoke all on public.projects from anon, authenticated;
grant select on public.projects to anon, authenticated;
grant insert, update, delete on public.projects to authenticated;
drop policy if exists "Published projects and admins can read projects" on public.projects;
drop policy if exists "Admins can add projects" on public.projects;
drop policy if exists "Admins can edit projects" on public.projects;
drop policy if exists "Admins can remove projects" on public.projects;
create policy "Published projects and admins can read projects" on public.projects
  for select to anon, authenticated using (is_published or (select private.is_portfolio_admin()));
create policy "Admins can add projects" on public.projects
  for insert to authenticated with check ((select private.is_portfolio_admin()));
create policy "Admins can edit projects" on public.projects
  for update to authenticated using ((select private.is_portfolio_admin()))
  with check ((select private.is_portfolio_admin()));
create policy "Admins can remove projects" on public.projects
  for delete to authenticated using ((select private.is_portfolio_admin()));

insert into public.projects (slug, title, category, year, description, art_key, sort_order) values
  ('sunshine', 'A little more sunshine', 'Illustration', 2025, 'A brighter kind of everyday.', 'one', 10),
  ('good-things', 'Good Things, naturally', 'Icon design', 2024, 'A botanical identity study.', 'two', 20),
  ('soft-hours', 'The Soft Hours', 'Poster', 2024, 'A study in slow living.', 'three', 30),
  ('sunday-rituals', 'Sunday Rituals', 'Drawing', 2023, 'A personal care packaging concept.', 'four', 40),
  ('type-wild', 'Type in the wild', '3D Design', 2023, 'Field notes on expressive typography.', 'five', 50),
  ('objects-feeling', 'Objects of feeling', 'Painting', 2022, 'A small study in form and feeling.', 'six', 60)
on conflict (slug) do nothing;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('portfolio-projects', 'portfolio-projects', true, 8388608, array['image/jpeg','image/png','image/webp','image/gif'])
on conflict (id) do update set public=excluded.public, file_size_limit=excluded.file_size_limit, allowed_mime_types=excluded.allowed_mime_types;
drop policy if exists "Public can view portfolio covers" on storage.objects;
drop policy if exists "Admins can upload portfolio covers" on storage.objects;
drop policy if exists "Admins can update portfolio covers" on storage.objects;
drop policy if exists "Admins can delete portfolio covers" on storage.objects;
create policy "Public can view portfolio covers" on storage.objects for select to anon, authenticated using (bucket_id='portfolio-projects');
create policy "Admins can upload portfolio covers" on storage.objects for insert to authenticated with check (bucket_id='portfolio-projects' and (select private.is_portfolio_admin()));
create policy "Admins can update portfolio covers" on storage.objects for update to authenticated using (bucket_id='portfolio-projects' and (select private.is_portfolio_admin())) with check (bucket_id='portfolio-projects' and (select private.is_portfolio_admin()));
create policy "Admins can delete portfolio covers" on storage.objects for delete to authenticated using (bucket_id='portfolio-projects' and (select private.is_portfolio_admin()));

-- After creating/confirming your admin user in Authentication > Users, run once:
-- insert into public.portfolio_admins (user_id)
-- select id from auth.users where lower(email)=lower('you@example.com')
-- on conflict (user_id) do nothing;
