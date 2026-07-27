-- Run this in your Supabase SQL Editor
INSERT INTO profiles (hattrick_user_id, manager_name, country_id, country_name)
SELECT DISTINCT 
    hattrick_user_id, 
    manager_name, 
    NULL as country_id, -- You may need to manually fill these or use a script to infer from team data
    country_name
FROM teams
WHERE hattrick_user_id IS NOT NULL
ON CONFLICT (hattrick_user_id) DO NOTHING;
