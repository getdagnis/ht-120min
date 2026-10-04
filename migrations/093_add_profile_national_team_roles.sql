ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS national_team_roles_json JSONB NOT NULL DEFAULT '[]'::jsonb;

ALTER TABLE public.profiles
  ADD CONSTRAINT profiles_national_team_roles_json_array
  CHECK (jsonb_typeof(national_team_roles_json) = 'array');

-- applied!