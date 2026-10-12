-- Backfill the manager IDs already contacted for the Around the World campaign.
-- The source list was supplied from Forge's existing localStorage record.
-- Safe to rerun: contacts are unique by campaign and manager.
BEGIN;

DO $$
DECLARE
  v_campaign_id constant text := 'around-the-world-in-one-twenty';
  v_source_count integer;
  v_inserted_count integer;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.forge_league_outreach_campaigns WHERE id = v_campaign_id
  ) THEN
    RAISE EXCEPTION 'Required outreach campaign is missing: %', v_campaign_id;
  END IF;

  CREATE TEMP TABLE around_the_world_contact_import (manager_id bigint PRIMARY KEY) ON COMMIT DROP;
  INSERT INTO around_the_world_contact_import (manager_id) VALUES
    (13546444), (699230), (4197822), (14618589), (14758717), (13783448),
    (14764625), (3054795), (2601762), (13802101), (14753150), (14756535),
    (14642299), (14150795), (2043077), (13106812), (13325772), (12297377),
    (14752481), (14051410), (12013908), (10408587), (12950303), (3400016),
    (13737621), (14245948), (11796120), (14755788), (14391092), (14744200),
    (6043122), (14576860), (89122), (14775692), (14769006), (13974383),
    (12720498), (13974407), (7841420), (14438333), (14749207), (11464368),
    (14763462), (14755499), (14773975), (10201087), (7143289), (9964616),
    (14771271), (14773844), (14743757), (9299358), (14037140), (14773539),
    (14749851), (14775451), (14760535), (14741274), (9057305), (14773294),
    (14756295), (14427396), (14719039), (14774742), (14412222), (14319914),
    (14771912), (14758708), (14768826), (14744972), (14756763), (6182558);

  SELECT count(*) INTO v_source_count FROM around_the_world_contact_import;

  INSERT INTO public.forge_league_outreach_contacts (campaign_id, manager_id)
  SELECT v_campaign_id, manager_id FROM around_the_world_contact_import
  ON CONFLICT (campaign_id, manager_id) DO NOTHING;
  GET DIAGNOSTICS v_inserted_count = ROW_COUNT;

  RAISE NOTICE 'Around the World outreach backfill: % supplied IDs, % inserted, % already present.',
    v_source_count, v_inserted_count, v_source_count - v_inserted_count;
END $$;

COMMIT;
