-- Superseded by the trusted HttpOnly app session + /api/presence endpoint.
-- Remove the anonymous user-id RPC so clients cannot spoof activity updates.
DROP FUNCTION IF EXISTS update_last_seen(BIGINT);

-- DONE!
