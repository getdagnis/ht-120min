-- DISPOSABLE EMPTY TEST CLUSTER ONLY, after synthetic source schema + 088/089.
-- These are API SHAPE STUBS, not real extensions or an HTTP/cron integration.
CREATE SCHEMA net;
CREATE SCHEMA cron;
CREATE SCHEMA vault;
CREATE TABLE net.fake_requests (id bigserial PRIMARY KEY, url text, body jsonb, headers jsonb);
CREATE TABLE cron.job (jobid bigserial PRIMARY KEY, jobname text UNIQUE, schedule text, command text, username text DEFAULT current_user);
CREATE TABLE vault.decrypted_secrets (name text UNIQUE, decrypted_secret text);
CREATE FUNCTION net.http_post(url text, body jsonb DEFAULT '{}', params jsonb DEFAULT '{}', headers jsonb DEFAULT '{}', timeout_milliseconds integer DEFAULT 2000)
RETURNS bigint LANGUAGE plpgsql AS $$ DECLARE result bigint; BEGIN
  IF current_setting('ht120.test_net_fail', true) = 'yes' THEN RAISE EXCEPTION 'Synthetic unavailable dispatcher'; END IF;
  INSERT INTO net.fake_requests(url, body, headers) VALUES (url, body, headers) RETURNING id INTO result;
  RETURN result;
END; $$;
CREATE FUNCTION cron.schedule(job_name text, cron_schedule text, cron_command text)
RETURNS bigint LANGUAGE sql AS $$
  INSERT INTO cron.job(jobname, schedule, command) VALUES (job_name, cron_schedule, cron_command)
  ON CONFLICT (jobname) DO UPDATE SET schedule = EXCLUDED.schedule, command = EXCLUDED.command
  RETURNING jobid;
$$;
CREATE FUNCTION cron.unschedule(id bigint) RETURNS boolean LANGUAGE plpgsql AS $$ BEGIN
  DELETE FROM cron.job WHERE jobid = id; RETURN FOUND;
END; $$;
REVOKE ALL ON SCHEMA net, cron, vault FROM PUBLIC, anon, authenticated, service_role;
