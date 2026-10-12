-- Private campaign contact ledger for the Forge Leagues helper.
-- Tracks only Hattrick manager ID, campaign and campaign date.
BEGIN;

CREATE TABLE public.forge_league_outreach_campaigns (
  id text PRIMARY KEY CHECK (id ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  name text NOT NULL CHECK (length(name) BETWEEN 1 AND 120),
  campaign_date date NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.forge_league_outreach_contacts (
  campaign_id text NOT NULL REFERENCES public.forge_league_outreach_campaigns(id) ON DELETE CASCADE,
  manager_id bigint NOT NULL CHECK (manager_id > 0),
  PRIMARY KEY (campaign_id, manager_id)
);

ALTER TABLE public.forge_league_outreach_campaigns ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.forge_league_outreach_contacts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.forge_league_outreach_campaigns, public.forge_league_outreach_contacts FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.forge_league_outreach_campaigns, public.forge_league_outreach_contacts TO service_role;

COMMENT ON TABLE public.forge_league_outreach_campaigns IS
  'Private admin campaign labels and approximate dates for Forge Leagues manager outreach.';
COMMENT ON TABLE public.forge_league_outreach_contacts IS
  'Private campaign-to-Hattrick-manager contact ledger; IDs are independent of team and profile records.';

INSERT INTO public.forge_league_outreach_campaigns (id, name, campaign_date) VALUES
  ('around-the-world-in-one-twenty', 'Around the World in One Twenty', '2026-10-12'),
  ('last-5-rounds', 'last 5 rounds', '2026-10-09'),
  ('exotic-hfi-tahiti', 'exotic hfi tahiti', '2026-09-28'),
  ('exotic-hfi-faroe', 'exotic hfi faroe', '2026-09-28'),
  ('exotic-hfi-gibraltar', 'exotic hfi gibraltar', '2026-09-28'),
  ('exotic-hfi-saint-kitts', 'exotic hfi saint kitts', '2026-09-28'),
  ('exotic-hfi-curacao', 'exotic hfi curacao', '2026-09-28'),
  ('exotic-hfi-san-marino', 'exotic hfi san marino', '2026-09-28')
ON CONFLICT (id) DO NOTHING;

DO $$
DECLARE
  v_source_count integer;
  v_inserted_count integer;
BEGIN
  CREATE TEMP TABLE outreach_import_rows ON COMMIT DROP AS
  WITH supplied(campaign_id, manager_ids) AS (VALUES
    ('last-5-rounds', ARRAY[8534162,10054472,6883187,3069464,11884844,4626110,11430801,9837541,12990491,1580506,11101128,4563381,283833,13712069,9747135,13553207,5667003,6432397,13754200,342870,7361817,2992110,3160679,13932170,13589016,12816134,13508881,427089,10755888,2137316,4139423,14690056,6304694,4231499,14190479,3797490,2186874,1037453]::bigint[]),
    ('exotic-hfi-tahiti', ARRAY[8671759,12974263,12068751,14248216,3674095,2098626,11683922,6105868,8077615,13009687,9902304,11754078,9050733,3775040,6686125,13096460,1569990,11283030,7406955,6981731,4563037,13137853,6547281,5230938,13914120,12302900,8958596,7813062,1372701,237730,11613460,13924029,11284944,10670732,6551060,8337248,13535570,13254202,13584967,411074,1969773,4729568,12538338,14130517,3770884]::bigint[]),
    ('exotic-hfi-faroe', ARRAY[7847571,1387878,2687037,2330293,13762611,5501578,13345619,1191074,5084895,5597631,7341972,5931194,14024080,13686592,14144179,13417179,13645473,14022699,2427879,13721943,9848887,9756939,9217332,8053100,168400,12680171,7021101,8620844]::bigint[]),
    ('exotic-hfi-gibraltar', ARRAY[9882446,1957756,3047788,13924181,13389051,8564124,14073799,11513052,12559762,6809489,9700459,1947835,14013196,1995256,1498540,13194293,1698301,9532949,9792850,1290516,12261510,342870,8122968,9567795,13613923,753524,4870657,6705670,1848465,1502296,14010346,3449393,14206606,9756641,4504069,13971560,14554463,5077411,9186227,4162434,13349384,2568024,1191279]::bigint[]),
    ('exotic-hfi-curacao', ARRAY[13186972,11261719,11681418,2254303,5373520,8438634,9122519,6859386,12457903,11288369,8462152,3023260,13260055,622946,6976841,1456579,11390962,8937304,244711,9674615,10042428,13793590,5782594,9034021,9289328,12681124,506248,11496835,130159,13264188,13428179,2748304,10628727,11301244,2249063,14493172]::bigint[]),
    ('exotic-hfi-saint-kitts', ARRAY[6626339,10519497,13870820,6297936,171878,12813845,13950775,13276906,13076819,10876443,2259968,2203267,8377372,4074049,1818566,13699855,3937122,11309176,10157523,2050515,13208322,13463801,5678627,4695871,6152036,10972376,5000754,7543629,14007776,2493989,2572760,14166040,13472097,13264127,14276591,9241007,9241592,7682294,13660187,1435762,12813585,3745018,10360300,14010123,2203922,4993600,10873369,6700571,3716818,4684214,13729093]::bigint[]),
    ('exotic-hfi-san-marino', ARRAY[10289805,14288289,13651153,5577193,13352802,14004462,12375172,13592267,13535373,8686258,13310231,3492396,9491504,7934706,13048060,7028365,13928465,13898914,13928608,13903251,14146362,4870697,2277629,13638685,9402492,12895530]::bigint[])
  ), rows AS (
    SELECT campaign_id, unnest(manager_ids) AS manager_id FROM supplied
  )
  SELECT campaign_id, manager_id FROM rows;
  SELECT count(*) INTO v_source_count FROM outreach_import_rows;

  INSERT INTO public.forge_league_outreach_contacts (campaign_id, manager_id)
  SELECT campaign_id, manager_id FROM outreach_import_rows
  ON CONFLICT (campaign_id, manager_id) DO NOTHING;
  GET DIAGNOSTICS v_inserted_count = ROW_COUNT;
  RAISE NOTICE 'Historical outreach import: % source rows, % inserted, % duplicates skipped, 0 invalid or unmatched rows.',
    v_source_count, v_inserted_count, v_source_count - v_inserted_count;
END $$;

COMMIT;

-- applied!