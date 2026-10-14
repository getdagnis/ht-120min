-- Prepared only. Snapshot mirrors shared/country-active-team-counts.ts (2026-10-12).
-- No existing rows are rewritten. Migration 113 supplies the shared membership lock.
CREATE FUNCTION public.country_size_snapshot_count(p_country_id integer) RETURNS integer
LANGUAGE sql IMMUTABLE SET search_path = '' AS $$
SELECT CASE p_country_id
WHEN 14 THEN 984
WHEN 27 THEN 293
WHEN 16 THEN 554
WHEN 25 THEN 407
WHEN 15 THEN 610
WHEN 24 THEN 248
WHEN 20 THEN 810
WHEN 29 THEN 239
WHEN 30 THEN 187
WHEN 32 THEN 210
WHEN 34 THEN 624
WHEN 37 THEN 353
WHEN 39 THEN 202
WHEN 41 THEN 195
WHEN 48 THEN 1136
WHEN 49 THEN 510
WHEN 50 THEN 153
WHEN 47 THEN 821
WHEN 53 THEN 198
WHEN 52 THEN 142
WHEN 56 THEN 253
WHEN 57 THEN 1113
WHEN 62 THEN 693
WHEN 63 THEN 828
WHEN 65 THEN 370
WHEN 64 THEN 99
WHEN 67 THEN 338
WHEN 68 THEN 240
WHEN 69 THEN 382
WHEN 70 THEN 158
WHEN 71 THEN 209
WHEN 72 THEN 194
WHEN 75 THEN 160
WHEN 76 THEN 140
WHEN 77 THEN 279
WHEN 78 THEN 195
WHEN 79 THEN 315
WHEN 83 THEN 407
WHEN 82 THEN 276
WHEN 87 THEN 303
WHEN 88 THEN 200
WHEN 89 THEN 158
WHEN 90 THEN 132
WHEN 91 THEN 599
WHEN 92 THEN 203
WHEN 94 THEN 356
WHEN 95 THEN 176
WHEN 96 THEN 122
WHEN 97 THEN 254
WHEN 98 THEN 119
WHEN 99 THEN 226
WHEN 100 THEN 365
WHEN 101 THEN 213
WHEN 103 THEN 111
WHEN 102 THEN 250
WHEN 105 THEN 112
WHEN 121 THEN 169
WHEN 122 THEN 175
WHEN 123 THEN 128
WHEN 125 THEN 293
WHEN 126 THEN 144
WHEN 127 THEN 135
WHEN 128 THEN 106
WHEN 86 THEN 134
WHEN 104 THEN 111
WHEN 129 THEN 98
WHEN 130 THEN 108
WHEN 131 THEN 159
WHEN 132 THEN 131
WHEN 134 THEN 118
WHEN 135 THEN 105
WHEN 133 THEN 175
WHEN 137 THEN 120
WHEN 136 THEN 184
WHEN 138 THEN 103
WHEN 139 THEN 96
WHEN 140 THEN 358
WHEN 142 THEN 193
WHEN 143 THEN 102
WHEN 144 THEN 114
WHEN 145 THEN 111
WHEN 147 THEN 115
WHEN 148 THEN 102
WHEN 149 THEN 122
WHEN 150 THEN 130
WHEN 153 THEN 113
WHEN 154 THEN 107
WHEN 163 THEN 122
WHEN 165 THEN 109
WHEN 93 THEN 134
WHEN 166 THEN 120
WHEN 177 THEN 179
WHEN 180 THEN 148
WHEN 175 THEN 111
WHEN 178 THEN 241
WHEN 179 THEN 113
WHEN 181 THEN 118
WHEN 182 THEN 108
WHEN 184 THEN 128
WHEN 186 THEN 107
WHEN 183 THEN 147
WHEN 185 THEN 110
WHEN 189 THEN 132
WHEN 187 THEN 102
WHEN 191 THEN 302
WHEN 188 THEN 108
WHEN 190 THEN 222
WHEN 194 THEN 168
WHEN 193 THEN 217
WHEN 192 THEN 209
WHEN 197 THEN 210
WHEN 196 THEN 275
WHEN 198 THEN 195
WHEN 199 THEN 263
WHEN 200 THEN 190
WHEN 202 THEN 302
WHEN 201 THEN 258
WHEN 203 THEN 315
WHEN 204 THEN 285
ELSE NULL END
$$;
REVOKE ALL ON FUNCTION public.country_size_snapshot_count(integer) FROM PUBLIC,anon,authenticated;

-- Include identity refreshes in the existing lock order so counts cannot race.
DROP TRIGGER serialize_team_membership ON public.teams;
CREATE TRIGGER serialize_team_membership
BEFORE DELETE OR INSERT OR UPDATE OF active,reserve_active,ht_team_id,tournament_id,reapply_season_number,country_id,hattrick_user_id,is_placeholder
ON public.teams FOR EACH STATEMENT EXECUTE FUNCTION public.lock_tournament_membership();

CREATE FUNCTION public.enforce_country_size_allowance() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE target public.tournaments%ROWTYPE; current_team public.teams%ROWTYPE;
  small_total integer; large_total integer; small_active integer; large_active integer;
  was_entry boolean := false; was_active boolean := false; count_value integer;
BEGIN
  -- Read the final state, including all rows in a bulk admission transaction.
  SELECT * INTO current_team FROM public.teams WHERE id=NEW.id;
  IF NOT FOUND OR current_team.is_placeholder OR current_team.ht_team_id IS NULL
    OR NOT (COALESCE(current_team.active,false) OR COALESCE(current_team.reserve_active,false)) THEN RETURN NULL; END IF;
  IF TG_OP='UPDATE' THEN
    was_entry := (COALESCE(OLD.active,false) OR COALESCE(OLD.reserve_active,false))
      AND OLD.tournament_id IS NOT DISTINCT FROM current_team.tournament_id
      AND OLD.ht_team_id IS NOT DISTINCT FROM current_team.ht_team_id;
    was_active := was_entry AND COALESCE(OLD.active,false) AND NOT COALESCE(OLD.reserve_active,false);
    -- Existing entrants and metadata changes are grandfathered; promotions are checked.
    IF was_entry AND (was_active OR NOT COALESCE(current_team.active,false)
      OR COALESCE(current_team.reserve_active,false)) THEN RETURN NULL; END IF;
  END IF;
  SELECT * INTO target FROM public.tournaments WHERE id=current_team.tournament_id;
  IF target.max_country_active_teams IS NULL THEN RETURN NULL; END IF;
  count_value := public.country_size_snapshot_count(current_team.country_id);
  IF count_value <= target.max_country_active_teams THEN RETURN NULL; END IF;
  IF NOT target.allow_manager_country_size_exception OR current_team.hattrick_user_id IS NULL THEN
    RAISE EXCEPTION 'The country-size registration allowance changed; refresh and try again' USING ERRCODE='23514';
  END IF;
  SELECT
    count(*) FILTER (WHERE public.country_size_snapshot_count(tm.country_id)<=target.max_country_active_teams),
    count(*) FILTER (WHERE COALESCE(public.country_size_snapshot_count(tm.country_id)>target.max_country_active_teams,true)),
    count(*) FILTER (WHERE tm.active AND NOT COALESCE(tm.reserve_active,false)
      AND public.country_size_snapshot_count(tm.country_id)<=target.max_country_active_teams),
    count(*) FILTER (WHERE tm.active AND NOT COALESCE(tm.reserve_active,false)
      AND COALESCE(public.country_size_snapshot_count(tm.country_id)>target.max_country_active_teams,true))
  INTO small_total,large_total,small_active,large_active
  FROM public.teams tm WHERE tm.tournament_id=current_team.tournament_id
    AND tm.hattrick_user_id=current_team.hattrick_user_id AND tm.ht_team_id IS NOT NULL
    AND NOT COALESCE(tm.is_placeholder,false) AND (tm.active OR tm.reserve_active);
  IF (NOT was_entry AND large_total>small_total)
    OR (current_team.active AND NOT COALESCE(current_team.reserve_active,false) AND large_active>small_active) THEN
    RAISE EXCEPTION 'The country-size registration allowance changed; refresh and try again' USING ERRCODE='23514';
  END IF;
  RETURN NULL;
END $$;
REVOKE ALL ON FUNCTION public.enforce_country_size_allowance() FROM PUBLIC,anon,authenticated;
-- WHEN is evaluated at the write, before the service-only admin bypass is reset.
CREATE CONSTRAINT TRIGGER enforce_country_size_allowance
AFTER INSERT OR UPDATE OF active,reserve_active,ht_team_id,tournament_id,country_id,hattrick_user_id,is_placeholder
ON public.teams DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW WHEN (COALESCE(current_setting('ht120.membership_bypass',true),'false') <> 'true')
EXECUTE FUNCTION public.enforce_country_size_allowance();
