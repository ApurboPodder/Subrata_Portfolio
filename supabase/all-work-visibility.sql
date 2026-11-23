-- Add persistent visibility control for the public All work filter.
-- Run once in the Supabase SQL Editor for an existing portfolio.

alter table public.portfolio_settings
  add column if not exists show_all_work boolean not null default true;
