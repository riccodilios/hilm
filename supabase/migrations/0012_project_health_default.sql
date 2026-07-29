-- Safe after 0010 commits the new enum labels.
alter table public.projects
  alter column health set default 'unengaged';
