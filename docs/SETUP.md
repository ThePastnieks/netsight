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
2. Paste the **whole** contents of
   [`supabase/migrations/003_full_schema.sql`](../supabase/migrations/003_full_schema.sql).
3. Press **Run**.

That one script creates everything: `profiles`, `sightings`, `shore_shapes`,
`devices`, the photo bucket, and row level security on all of them.

**Run only that file.** It is self-contained and safe to run again — every
statement checks before it creates. You do not need `001`; it exists only as
history, and running it first is what produces
`relation "public.sightings" does not exist` if you skip it.

When it finishes, **Table Editor** should list five tables: `profiles`,
`sightings`, `shore_shapes`, `devices`, `registered_gear`.

> Adding this to a database that already ran an older copy? Run
> [`005_registered_gear.sql`](../supabase/migrations/005_registered_gear.sql)
> — it creates just the new table and its policies.

The script ends with `grant` statements. Those are not optional: row level
security decides which **rows** a role may touch, but Postgres separately decides
whether the role may touch the **table**. Without the grants every request fails
with

```
401 {"code":"42501","message":"permission denied for table profiles"}
```

even though the policies are correct. Both checks must pass.

> The project home page will still say *Last migration: No migrations*. That
> counter only tracks the Supabase CLI, not the SQL editor. Ignore it.

## 3. Switch the Email provider on, and confirmation off

Both are on the same screen: **Authentication → Sign In / Providers**.

| Switch | Set it to | Why |
|---|---|---|
| **Email** (under Auth Providers) | **Enabled** | Newer projects ship with it **disabled**, and every signup fails with `email_provider_disabled` / "Email signups are disabled" |
| **Allow new users to sign up** | **On** | Otherwise nobody can register at all |
| **Confirm email** | **Off** | The app signs in with a username, so there is no inbox to confirm from |

The Email row showing `DISABLED` in the providers list is the one that catches
people: the sign-up form looks perfect and refuses every attempt. Open that row
and enable it.

Without these, signup stops at "Account created, but Supabase still wants an
email confirmation" — or fails before it starts.

The app also signs up with `username@netsight.lv`. That domain is never used to
send anything — it only satisfies the shape Supabase expects. It must be a
plausible domain: `.local` is rejected outright with
`email_address_invalid`. If you change `CONFIG.AUTH_EMAIL_DOMAIN`, change it
**before** the first signup, because existing accounts are keyed to it.

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

**`relation "public.sightings" does not exist`**
You are running an old copy of `003_full_schema.sql`. The current one creates
`sightings` itself. Pull the latest and paste it again — no need to run `001`.

**`401 {"code":"42501","message":"permission denied for table …"}`**
The grants at the end of `003` did not run, or ran before the tables existed.
Re-run the whole file; it is idempotent. Verify with:

```sql
select grantee, table_name, privilege_type
from information_schema.role_table_grants
where table_schema = 'public' and grantee in ('anon','authenticated')
order by table_name, grantee;
```

You want rows for `authenticated` (select, insert, update, delete) and for `anon`
(select) on all four tables.

**`email_address_invalid` on signup**
The `AUTH_EMAIL_DOMAIN` in `js/config.js` is a reserved name. Use a normal domain
— `netsight.lv` works, `netsight.local` does not.

**"Email signups are disabled" / `email_provider_disabled`**
The Email provider is switched off. **Authentication → Sign In / Providers** →
open the **Email** row (it says `DISABLED`) → enable it → Save. New projects ship
this way, and the sign-up form gives no hint that the cause is a switch.

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

Then run `003_full_schema.sql` again. Auth users survive in `auth.users` —
delete them under **Authentication → Users** if you want a genuinely clean start.







