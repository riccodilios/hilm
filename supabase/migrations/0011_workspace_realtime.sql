-- Live dashboard: broadcast workspace table changes to authenticated clients.
do $$ begin
  alter publication supabase_realtime add table public.tasks;
exception when duplicate_object then null;
end $$;

do $$ begin
  alter publication supabase_realtime add table public.projects;
exception when duplicate_object then null;
end $$;

do $$ begin
  alter publication supabase_realtime add table public.activity_events;
exception when duplicate_object then null;
end $$;

do $$ begin
  alter publication supabase_realtime add table public.notes;
exception when duplicate_object then null;
end $$;

do $$ begin
  alter publication supabase_realtime add table public.daily_logs;
exception when duplicate_object then null;
end $$;
