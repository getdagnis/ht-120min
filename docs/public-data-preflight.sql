-- Read-only metadata. No tokens, password values, private records or job commands.
-- Run privately against the intended environment with an authorized DB connection.
BEGIN READ ONLY;

SELECT current_setting('server_version') AS postgres_version;
SELECT extname, extversion FROM pg_extension
  WHERE extname IN ('pg_cron', 'pg_net', 'pgcrypto', 'pg_jsonschema') ORDER BY extname;

SELECT table_name, column_name, data_type
FROM information_schema.columns
WHERE table_schema = 'public' AND table_name IN (
  'tournaments', 'teams', 'profiles', 'matches', 'tournament_seasons',
  'tournament_roles', 'public_snapshots', 'historical_snapshot_revisions'
)
ORDER BY table_name, ordinal_position;

SELECT grantee, table_name, privilege_type
FROM information_schema.table_privileges
WHERE table_schema = 'public' AND grantee IN ('PUBLIC', 'anon', 'authenticated', 'service_role')
  AND table_name IN ('tournaments', 'teams', 'profiles', 'public_snapshots', 'historical_snapshot_revisions')
ORDER BY table_name, grantee, privilege_type;

SELECT grantee, table_name, column_name, privilege_type
FROM information_schema.column_privileges
WHERE table_schema = 'public' AND grantee IN ('PUBLIC', 'anon', 'authenticated')
  AND table_name IN ('tournaments', 'teams', 'profiles')
ORDER BY table_name, column_name, grantee, privilege_type;

SELECT schemaname, tablename, policyname, roles, cmd
FROM pg_policies WHERE schemaname = 'public'
  AND tablename IN ('tournaments', 'teams', 'profiles', 'matches', 'tournament_seasons',
    'public_snapshots', 'historical_snapshot_revisions')
ORDER BY tablename, policyname;

-- Inspect actual predicates/RPC definitions separately; names alone do not prove safety.
-- If cron.job exists, inspect jobid/schedule/active privately; never paste its command
-- or webhook configuration into logs/docs because these can contain dispatch secrets.
ROLLBACK;
