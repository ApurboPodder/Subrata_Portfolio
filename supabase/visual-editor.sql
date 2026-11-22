-- Add saved copy for editable site text used by the Studio visual editor.
alter table public.portfolio_settings
  add column if not exists site_content jsonb not null default '{}'::jsonb;
