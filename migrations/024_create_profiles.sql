CREATE TABLE profiles (
  hattrick_user_id BIGINT PRIMARY KEY,
  manager_name TEXT NOT NULL,
  country_id INTEGER,
  country_name TEXT,
  avatar_json JSONB,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Public Read" ON profiles FOR SELECT USING (true);
CREATE POLICY "Allow All for MVP" ON profiles FOR ALL USING (true) WITH CHECK (true);
