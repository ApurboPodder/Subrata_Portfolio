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
