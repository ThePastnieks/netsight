# NetSight — database setup

The app runs in two modes. This document is the one-time setup that switches it
from **local** (everything stays in one browser) to **cloud** (accounts, shore
shapes, buoys and sightings shared across every device).

Total time: about ten minutes.

---

## 1. Create the Supabase project

1. Go to <https://supabase.com/dashboard> and sign in (GitHub login is fastest).
2. **New project**.
   - Name: `netsight`
   - Database password: generate one and keep it — you will not need it day to
     day, but you cannot recover it.
   - Region: **Frankfurt** (`eu-central-1`) is the closest to Latvia.
3. Wait two minutes while it provisions.

## 2. Create the tables

1. In the project, open **SQL Editor** → **New query**.
2. Paste the contents of
   [`supabase/migrations/003_full_schema.sql`](../supabase/migrations/003_full_schema.sql).
3. Press **Run**.

That single script creates `profiles`, `shore_shapes`, `devices`, adds the
missing columns to `sightings`, creates the photo bucket, and turns on row level
security everywhere.

> If you have not run `001_initial_schema.sql` yet, run it first — `003` extends
> the `sightings` table it creates.

## 3. Turn off email confirmation

The app signs in with a username, not an email, so there is no inbox to confirm
from.

**Authentication → Providers → Email** → turn **Confirm email** off → **Save**.

Without this, every signup stops at "Account created, but Supabase still wants an
email confirmation".

## 4. Copy the two keys

**Project Settings → API**:

| Field | Goes into |
|---|---|
| **Project URL** | `CONFIG.SUPABASE_URL` |
| **anon / public** key | `CONFIG.SUPABASE_ANON_KEY` |

Open [`js/config.js`](../js/config.js) and fill them in:

```js
SUPABASE_URL: 'https://abcdefghijkl.supabase.co',
SUPABASE_ANON_KEY: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...',
```

> The anon key is public by design — it ships to the browser either way. What
> protects the data is row level security, which step 2 already set up. **Never**
> put the `service_role` key here; it bypasses every policy.

## 5. Sign up the first account

Open the site, press **Create account**, and register. **The first account
becomes the administrator** — the database trigger decides that, not the browser.

Everyone after that starts as a normal user. Promote them in **Admin → Users**.

## 6. Deploy

### Vercel (what you are using)

The server functions live in `api/`, which is where Vercel looks:

```
api/detect.js       photo → verdict
api/telemetry.js    buoy → database
```

Push to GitHub; Vercel redeploys automatically. No environment variables are
needed for the front end — the keys are in `config.js`.

`api/telemetry.js` **does** want two, because a buoy has no user session and
cannot write past row level security:

**Vercel → Settings → Environment Variables**

| Name | Value |
|---|---|
| `SUPABASE_URL` | your project URL |
| `SUPABASE_SERVICE_KEY` | the **service_role** key |

Without them, telemetry is validated and echoed but not stored.

### Netlify

Change one line in `js/config.js`:

```js
endpoint: '/.netlify/functions/detect',
```

The `netlify/functions/` versions already exist.

## 7. Check it worked

1. Sign in as the admin.
2. **Admin → Shore** → draw a polygon. It should appear in the list.
3. Open the site in a **different browser** and sign in as a different account.
   The shape is there. That is the whole point.
4. **Admin → Devices → Load demo fleet** to get seven example buoys.

If the sign-in screen still says *"Local mode"*, the two keys in `config.js` are
empty or the deploy has not picked them up yet.

---

## What each role sees

| | User | Water Patrol | Administrator |
|---|---|---|---|
| Map with buoys | ✓ | ✓ | ✓ |
| Report gear | ✓ | ✓ | ✓ |
| The 50 m limit | ✓ | ✓ | ✓ |
| Case list | — | ✓ | ✓ |
| Change case status | — | ✓ | ✓ |
| Delete points | — | — | ✓ |
| Draw the shore | — | — | ✓ |
| Manage accounts | — | — | ✓ |

Row level security enforces this on the server, not just in the interface.

---

## Troubleshooting

**"That account has no profile and cannot sign in"**
The trigger did not run. Re-run `003_full_schema.sql` and check
**Database → Triggers** for `on_auth_user_created`.

**Sign-up succeeds but the account cannot sign in**
Email confirmation is still on. See step 3.

**Everything is empty after signing in**
Row level security is working and the session is not reaching the query. Make
sure you signed in *after* the keys were added — reload the page.

**"new row violates row level security policy"**
The action needs a higher role. Check **Admin → Users** that the account has the
role you expect.

**Free projects pause after a week of inactivity**
Supabase pauses a free project that nobody touches for seven days. The first
request afterwards takes a few seconds to wake it. Fine for a demo; upgrade to
Pro ($25/mo) before real users arrive.

---

## Regenerating or starting over

Drop everything and re-run:

```sql
drop table if exists public.sightings cascade;
drop table if exists public.shore_shapes cascade;
drop table if exists public.devices cascade;
drop table if exists public.profiles cascade;
drop function if exists public.handle_new_user() cascade;
drop function if exists public.is_admin() cascade;
drop function if exists public.my_role() cascade;
```

Then run `001_initial_schema.sql` and `003_full_schema.sql` again. Auth users
survive in `auth.users` — delete them under **Authentication → Users** if you
want a genuinely clean start.
