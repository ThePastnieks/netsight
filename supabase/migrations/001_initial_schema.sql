-- NetSight Database Schema — SUPERSEDED
--
-- Do not run this on a new project. Run 003_full_schema.sql instead: it creates
-- everything this file does, plus profiles, shore_shapes, devices and the role
-- policies, and it is safe to run more than once.
--
-- This file is kept only as history. It is what 003 was built from.

-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Sightings table
CREATE TABLE sightings (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  photo_url TEXT,
  lat DOUBLE PRECISION NOT NULL,
  lon DOUBLE PRECISION NOT NULL,
  accuracy_m INTEGER,
  detected_class TEXT NOT NULL CHECK (detected_class IN ('buoy','float','net','trap','none','unknown')),
  confidence DOUBLE PRECISION NOT NULL CHECK (confidence >= 0 AND confidence <= 1),
  user_class TEXT NOT NULL CHECK (user_class IN ('buoy','float','net','trap','unknown')),
  registry_id TEXT,
  registry_match BOOLEAN DEFAULT FALSE,
  status TEXT NOT NULL DEFAULT 'new' CHECK (status IN ('new','reported','checked','resolved','false_alarm')),
  report_reason TEXT CHECK (report_reason IN ('unmarked','abandoned','hazard','possibly_illegal','other')),
  inspector_id TEXT,
  note TEXT DEFAULT ''
);

-- Indexes for common queries
CREATE INDEX idx_sightings_status ON sightings(status);
CREATE INDEX idx_sightings_created ON sightings(created_at DESC);
CREATE INDEX idx_sightings_location ON sightings(lat, lon);
CREATE INDEX idx_sightings_user_class ON sightings(user_class);
CREATE INDEX idx_sightings_registry_match ON sightings(registry_match);

-- Enable Realtime for sightings table
ALTER PUBLICATION supabase_realtime ADD TABLE sightings;

-- Row Level Security
ALTER TABLE sightings ENABLE ROW LEVEL SECURITY;

-- Public read access (anyone can view sightings on map)
CREATE POLICY "Public read sightings" ON sightings FOR SELECT USING (true);

-- Authenticated users can insert sightings
CREATE POLICY "Authenticated insert sightings" ON sightings FOR INSERT WITH CHECK (auth.role() = 'authenticated');

-- Inspectors (service role or custom claim) can update sightings
CREATE POLICY "Inspector update sightings" ON sightings FOR UPDATE USING (
  auth.jwt() ->> 'role' = 'inspector' OR auth.role() = 'service_role'
);

-- Storage bucket for sighting photos
INSERT INTO storage.buckets (id, name, public) VALUES ('sightings-photos', 'sightings-photos', true)
ON CONFLICT (id) DO NOTHING;

-- Storage policies
CREATE POLICY "Public read photos" ON storage.objects FOR SELECT USING (bucket_id = 'sightings-photos');

CREATE POLICY "Authenticated upload photos" ON storage.objects FOR INSERT WITH CHECK (
  bucket_id = 'sightings-photos' AND auth.role() = 'authenticated'
);

-- Function to auto-update updated_at timestamp
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ language 'plpgsql';

-- Trigger to update updated_at on sightings
DROP TRIGGER IF EXISTS update_sightings_updated_at ON sightings;
CREATE TRIGGER update_sightings_updated_at
  BEFORE UPDATE ON sightings
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

-- Optional: Create a view for inspector dashboard with computed fields
CREATE OR REPLACE VIEW inspector_cases AS
SELECT
  id,
  created_at,
  updated_at,
  photo_url,
  lat,
  lon,
  accuracy_m,
  detected_class,
  confidence,
  user_class,
  registry_id,
  registry_match,
  status,
  report_reason,
  inspector_id,
  note,
  CASE status
    WHEN 'reported' THEN 5
    WHEN 'new' THEN 4
    WHEN 'checked' THEN 3
    WHEN 'resolved' THEN 1
    WHEN 'false_alarm' THEN 0
    ELSE 0
  END AS status_priority
FROM sightings
ORDER BY created_at DESC;

