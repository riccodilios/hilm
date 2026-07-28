-- Prefer the cheaper default model for new and existing users
alter table public.user_settings
  alter column default_model set default 'google/gemini-2.5-flash';

update public.user_settings
set default_model = 'google/gemini-2.5-flash'
where default_model = 'anthropic/claude-sonnet-4'
   or default_model is null
   or default_model = '';
