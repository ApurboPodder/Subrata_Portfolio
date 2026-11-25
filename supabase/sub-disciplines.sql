-- Add parent-child relationships to project disciplines.
-- Run once on an existing portfolio project.

alter table public.portfolio_disciplines
  add column if not exists parent_id uuid references public.portfolio_disciplines(id) on delete restrict;

notify pgrst, 'reload schema';
