# NetSight - Fishing Gear Reporting Prototype

A mobile-friendly web application for reporting and tracking lost/abandoned fishing gear. Built as a prototype with demo mode for offline presentations.

## Features

- **Photo upload** with camera/gallery, GPS/EXIF/manual location capture
- **AI detection** of fishing gear (buoys, floats, nets, traps) via Roboflow or Claude Vision API
- **Live map** with status-colored pins (OpenStreetMap + Leaflet)
- **Registry matching** - auto-matches sightings to registered gear within 50m
- **One-tap reporting** - escalate to authorities with reason
- **Inspector dashboard** - case table, filters, status transitions
- **Demo mode** - works offline with stored sample data
- **Supabase backend** - Postgres, Storage, Realtime, RLS

## Quick Start

### Prerequisites

- Node.js 18+
- Supabase account (for live backend)
- Netlify account (for deployment) or any static host

### Local Development

```bash
# Clone and enter directory
cd netsight

# Install dependencies (for Netlify functions)
cd netlify/functions && npm init -y && npm install && cd ../..

# Start local dev server (any static server)
npx serve .
# or
python -m http.server 8000
# or
php -S localhost:8000
```

Open `http://localhost:8000` for the boater app, or `http://localhost:8000/inspector.html` for the inspector dashboard.

### Demo Mode (No Backend Required)

The app runs in **demo mode by default** - no Supabase or API keys needed. It uses:
- Stored sample sightings (`data/demo-sightings.json`)
- Stored sample registry (`data/registry.csv`)
- Simulated AI detection results (`js/config.js`)

Perfect for offline presentations and testing.

## Live Backend Setup

### 1. Supabase Project

1. Create a new Supabase project
2. Run the SQL migrations in `supabase/migrations/` (see below)
3. Enable Realtime on the `sightings` table
4. Create storage bucket `sightings-photos` (public)
5. Copy your Project URL and Anon Key

### 2. Configure Environment

Create `.env` in project root:
```env
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_ANON_KEY=your-anon-key
```

Update `js/config.js`:
```js
SUPABASE_URL: 'https://your-project.supabase.co',
SUPABASE_ANON_KEY: 'your-anon-key',
DEMO_MODE: false
```

### 3. Detection API (Optional)

For live AI detection, configure **one** of:

**Roboflow** (recommended - faster, cheaper):
```env
ROBOFLOW_API_URL=https://detect.roboflow.com
ROBOFLOW_MODEL_ID=fishing-gear/1
ROBOFLOW_API_KEY=your-roboflow-key
```

**Claude Vision API**:
```env
CLAUDE_API_KEY=your-claude-api-key
```

Deploy the Netlify function at `netlify/functions/detect.js` with these env vars.

## Database Schema

Run in Supabase SQL Editor:

```sql
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

-- Indexes
CREATE INDEX idx_sightings_status ON sightings(status);
CREATE INDEX idx_sightings_created ON sightings(created_at DESC);
CREATE INDEX idx_sightings_location ON sightings(lat, lon);

-- Enable Realtime
ALTER PUBLICATION supabase_realtime ADD TABLE sightings;

-- RLS Policies
ALTER TABLE sightings ENABLE ROW LEVEL SECURITY;

-- Public read access
CREATE POLICY "Public read" ON sightings FOR SELECT USING (true);

-- Authenticated insert (boaters)
CREATE POLICY "Authenticated insert" ON sightings FOR INSERT WITH CHECK (auth.role() = 'authenticated');

-- Inspector updates (service role or custom claim)
CREATE POLICY "Inspector update" ON sightings FOR UPDATE USING (
  auth.jwt() ->> 'role' = 'inspector' OR auth.role() = 'service_role'
);

-- Storage bucket
INSERT INTO storage.buckets (id, name, public) VALUES ('sightings-photos', 'sightings-photos', true);

-- Storage policies
CREATE POLICY "Public read photos" ON storage.objects FOR SELECT USING (bucket_id = 'sightings-photos');
CREATE POLICY "Authenticated upload photos" ON storage.objects FOR INSERT WITH CHECK (bucket_id = 'sightings-photos' AND auth.role() = 'authenticated');
```

## Deployment

### Netlify (Recommended)

1. Push to GitHub
2. Connect repo to Netlify
3. Build settings:
   - Build command: (empty - static site)
   - Publish directory: `netsight` (or root)
   - Functions directory: `netlify/functions`
4. Add environment variables in Netlify dashboard
5. Deploy

### Vercel

```bash
npm i -g vercel
vercel --prod
```

Configure `vercel.json` for SPA routing and functions.

### Static Hosting (GitHub Pages, Cloudflare Pages, etc.)

For demo mode only - just upload the `netsight` folder. No functions or backend needed.

## Project Structure

```
netsight/
├── index.html              # Boater app (map + report)
├── inspector.html          # Inspector dashboard
├── css/
│   └── style.css           # Full design system
├── js/
│   ├── config.js           # Configuration & demo data
│   ├── location.js         # GPS/EXIF/manual location
│   ├── registry.js         # CSV registry + Haversine matching
│   ├── status.js           # Status machine + pin colors
│   ├── map.js              # Leaflet map + pins + filters
│   ├── ui.js               # Forms, modals, toasts, screens
│   ├── detect.js           # Detection API client
│   ├── store.js            # Supabase CRUD + demo fallback
│   ├── app.js              # Main app coordinator
│   └── inspector.js        # Inspector dashboard logic
├── data/
│   ├── registry.csv        # Sample registry (10 items near Riga)
│   └── demo-sightings.json # Sample sightings (5, all statuses)
├── netlify/
│   └── functions/
│       └── detect.js       # Serverless detection proxy
├── supabase/
│   └── migrations/         # SQL schema (see above)
└── assets/
    └── netsight-logo.svg   # Logo
```

## Status Machine

```
new → reported → checked → resolved
         ↘                    ↗
           → false_alarm → checked (reopen)
```

Pin colors:
- 🟢 Green - Registered gear
- 🟠 Orange - Unverified (new, no registry match)
- 🔴 Red - Reported
- 🔵 Blue - Checked by inspector
- ⚫ Grey - Resolved / False alarm

## Registry Matching

- **Radius**: 50 meters (Haversine formula)
- **Type compatibility**:
  - Buoy matches all types (marks any gear)
  - Float matches net or buoy
  - Net matches net
  - Trap matches trap

## Demo Data

The prototype includes sample data near Riga, Latvia (56.95, 24.11):
- 10 registry items (buoys, nets, traps, floats)
- 5 sightings covering all statuses

## Browser Support

- Chrome/Edge 90+
- Firefox 88+
- Safari 14+
- Mobile Safari/Chrome

Requires: ES2020, Geolocation API, FileReader, fetch, CSS Grid/Flexbox

## Configuration

Key settings in `js/config.js`:
```js
DEMO_MODE: true,                    // Use stored data
CONF_THRESHOLD: 0.35,               // Min confidence for auto-type-select
MAX_PHOTO_MB: 5,                    // Max upload size
DETECT_API_ENDPOINT: '/.netlify/functions/detect',
SUPABASE_URL: '',                   // Your Supabase URL
SUPABASE_ANON_KEY: '',              // Your Supabase anon key
```

## License

MIT - Prototype for demonstration purposes.