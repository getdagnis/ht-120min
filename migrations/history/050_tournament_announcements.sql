-- Dedicated dismissible tournament announcements.
-- Apply after 049_reschedule_tournament_rounds_rpc.sql.

BEGIN;

CREATE TABLE IF NOT EXISTS public.tournament_announcements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tournament_id uuid NOT NULL REFERENCES public.tournaments(id) ON DELETE CASCADE,
  content text NOT NULL CHECK (btrim(content) <> ''),
  template_key text,
  visibility text NOT NULL DEFAULT 'participants' CHECK (visibility IN ('participants', 'public')),
  source text NOT NULL DEFAULT 'admin' CHECK (source IN ('admin', 'system')),
  audience_ht_user_ids bigint[] DEFAULT ARRAY[]::bigint[],
  is_active boolean NOT NULL DEFAULT true,
  created_by_name text,
  created_by_ht_user_id bigint,
  created_at timestamptz NOT NULL DEFAULT now(),
  hidden_at timestamptz
);

CREATE INDEX IF NOT EXISTS tournament_announcements_tournament_created_idx
  ON public.tournament_announcements(tournament_id, created_at DESC);

CREATE INDEX IF NOT EXISTS tournament_announcements_tournament_active_idx
  ON public.tournament_announcements(tournament_id, is_active, created_at DESC);

CREATE TABLE IF NOT EXISTS public.tournament_announcement_dismissals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tournament_id uuid NOT NULL REFERENCES public.tournaments(id) ON DELETE CASCADE,
  announcement_id uuid REFERENCES public.tournament_announcements(id) ON DELETE CASCADE,
  notice_key text,
  hattrick_user_id bigint NOT NULL,
  dismissed_at timestamptz NOT NULL DEFAULT now(),
  CHECK (
    (announcement_id IS NOT NULL AND notice_key IS NULL)
    OR (announcement_id IS NULL AND notice_key IS NOT NULL)
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS tournament_announcement_dismissals_announcement_user_idx
  ON public.tournament_announcement_dismissals(announcement_id, hattrick_user_id)
  WHERE announcement_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS tournament_announcement_dismissals_notice_user_idx
  ON public.tournament_announcement_dismissals(tournament_id, notice_key, hattrick_user_id)
  WHERE notice_key IS NOT NULL;

ALTER TABLE public.tournament_announcements ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tournament_announcement_dismissals ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Anyone can view tournament announcements" ON public.tournament_announcements;
CREATE POLICY "Anyone can view tournament announcements"
  ON public.tournament_announcements
  FOR SELECT
  USING (true);

DROP POLICY IF EXISTS "Anyone can create tournament announcements" ON public.tournament_announcements;
CREATE POLICY "Anyone can create tournament announcements"
  ON public.tournament_announcements
  FOR INSERT
  WITH CHECK (true);

DROP POLICY IF EXISTS "Anyone can update tournament announcements" ON public.tournament_announcements;
CREATE POLICY "Anyone can update tournament announcements"
  ON public.tournament_announcements
  FOR UPDATE
  USING (true)
  WITH CHECK (true);

DROP POLICY IF EXISTS "Anyone can view tournament announcement dismissals" ON public.tournament_announcement_dismissals;
CREATE POLICY "Anyone can view tournament announcement dismissals"
  ON public.tournament_announcement_dismissals
  FOR SELECT
  USING (true);

DROP POLICY IF EXISTS "Anyone can create tournament announcement dismissals" ON public.tournament_announcement_dismissals;
CREATE POLICY "Anyone can create tournament announcement dismissals"
  ON public.tournament_announcement_dismissals
  FOR INSERT
  WITH CHECK (true);

COMMIT;


-- MIGRATION APPLIED!
