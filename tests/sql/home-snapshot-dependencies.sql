-- DISPOSABLE SYNTHETIC DATABASE ONLY. Minimal tables deliberately do not model
-- production constraints. Run BEFORE 088/089, then home-snapshot-assertions.sql.
CREATE ROLE anon;
CREATE ROLE authenticated;
CREATE ROLE service_role BYPASSRLS;
CREATE TABLE public.tournaments (id text PRIMARY KEY, name text, is_private boolean DEFAULT false, admin_password text);
CREATE TABLE public.teams (id text PRIMARY KEY, tournament_id text, name text, oauth_token text);
CREATE TABLE public.rounds (id text PRIMARY KEY, tournament_id text, round_number integer);
CREATE TABLE public.matches (id text PRIMARY KEY, round_id text, completed boolean, status text, last_live_refresh_at timestamptz);
CREATE TABLE public.fixture_warnings (id text PRIMARY KEY, round_id text, team_id text, active boolean);
CREATE TABLE public.news_posts (id text PRIMARY KEY, tournament_id text, content text, is_round_report boolean);
GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.tournaments, public.teams, public.rounds, public.matches, public.fixture_warnings, public.news_posts TO anon, service_role;
