-- 029_fix_chat_fk.sql
-- Remove the problematic foreign key constraint on tournament_chat.author_ht_id

DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM information_schema.table_constraints 
        WHERE constraint_name = 'tournament_chat_author_ht_id_fkey' 
        AND table_name = 'tournament_chat'
    ) THEN
        ALTER TABLE tournament_chat DROP CONSTRAINT tournament_chat_author_ht_id_fkey;
    END IF;
END $$;

COMMENT ON COLUMN tournament_chat.author_ht_id IS 'Hattrick User ID of the message author. 0 is reserved for Tournament Administration. No foreign key to profiles to allow system messages.';
