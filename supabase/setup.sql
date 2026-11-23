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

-- Add editable About portrait and Home cover image settings.
-- Safe to run once on an existing portfolio project.

create table if not exists public.portfolio_settings (
  id boolean primary key default true check (id),
  portrait_path text,
  hero_cover_path text,
  show_all_work boolean not null default true,
  updated_at timestamptz not null default now()
);
alter table public.portfolio_settings add column if not exists show_all_work boolean not null default true;
insert into public.portfolio_settings (id) values (true)
on conflict (id) do nothing;
alter table public.portfolio_settings enable row level security;
revoke all on public.portfolio_settings from anon, authenticated;
grant select on public.portfolio_settings to anon, authenticated;
grant update on public.portfolio_settings to authenticated;
drop policy if exists "Public can read portfolio image settings" on public.portfolio_settings;
drop policy if exists "Admins can update portfolio image settings" on public.portfolio_settings;
create policy "Public can read portfolio image settings"
  on public.portfolio_settings for select to anon, authenticated using (true);
create policy "Admins can update portfolio image settings"
  on public.portfolio_settings for update to authenticated
  using ((select private.is_portfolio_admin()))
  with check ((select private.is_portfolio_admin()));

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

-- Add persistent project discipline categories.
-- Run once on an existing portfolio project.

create table if not exists public.portfolio_disciplines (
  id uuid primary key default gen_random_uuid(),
  name text not null unique check (char_length(trim(name)) between 1 and 40),
  sort_order integer not null default 0,
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
