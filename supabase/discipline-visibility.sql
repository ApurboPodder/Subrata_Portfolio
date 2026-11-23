-- Allow Studio admins to hide or show disciplines without deleting them.
-- Run this once in the Supabase SQL Editor for an existing portfolio.

alter table public.portfolio_disciplines
  add column if not exists is_visible boolean not null default true;

grant update (is_visible) on public.portfolio_disciplines to authenticated;
drop policy if exists "Admins can update portfolio discipline visibility" on public.portfolio_disciplines;
create policy "Admins can update portfolio discipline visibility"
  on public.portfolio_disciplines for update to authenticated
  using ((select private.is_portfolio_admin()))
  with check ((select private.is_portfolio_admin()));
