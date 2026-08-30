-- 028_add_author_ht_id_to_chat.sql
-- Add author_ht_id column to tournament_chat table

ALTER TABLE tournament_chat 
ADD COLUMN author_ht_id BIGINT;

-- Add a comment explaining the column
COMMENT ON COLUMN tournament_chat.author_ht_id IS 'Hattrick User ID of the message author. 0 is reserved for Tournament Administration.';
