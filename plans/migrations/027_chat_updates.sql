-- 027_chat_updates.sql
-- Add author_ht_id to tournament_chat and link to profiles

ALTER TABLE tournament_chat 
ADD COLUMN author_ht_id BIGINT REFERENCES profiles(hattrick_user_id) ON DELETE SET NULL;

-- Backfill: If author_name matches a manager_name in profiles, we could try to link it, 
-- but it's safer to just start from now as author_name is not guaranteed unique across all of HT.
