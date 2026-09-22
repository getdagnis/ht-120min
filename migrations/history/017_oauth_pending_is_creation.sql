-- Track creation-flow pending joins (callback redirects to /create, not /oauth/select)
ALTER TABLE oauth_pending_joins ADD COLUMN IF NOT EXISTS is_creation BOOLEAN DEFAULT false;
