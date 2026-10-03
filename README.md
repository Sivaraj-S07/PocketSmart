# PocketSmart AI — Your Smart Budget & Recommendation Assistant

A FastAPI web app that plans budgets for **home interiors**, **parties** and **jewelry** in INR, with
optional **Google Gemini** recommendations (including outfit-image analysis), shopping links for Indian
platforms, user accounts and per-user history. The production database is **Supabase PostgreSQL**.

| | |
|---|---|
| Backend | FastAPI, Pydantic v2, SQLAlchemy 2 (`backend/`) |
| Frontend | Jinja2 templates + HTML/CSS/JS, served by the backend (`frontend/`) |
| Database | **Supabase PostgreSQL** (schema in `supabase/schema.sql`); SQLite only as a zero-config local fallback |
| AI | Google Gemini (optional; automatic offline fallback plans) |
| Auth | bcrypt passwords, JWT in an HttpOnly cookie, server-side sessions with logout revocation |
| Hosting | Render (app) and optionally Vercel (front door / proxy) |

> **What changed in the Supabase migration:** only the database integration and configuration. UI, features,
> routes and business logic are unchanged (`frontend/` is byte-identical to the previous `templates/` + `static/`).
> Details are in [§ 10 Migration notes](#10-migration-notes).

---

## 1. Features (mapped to the SRS)

- **Home Interior Planner** — budget, room types (Living Room / Kitchen / Bedroom / …), and **quantities of lights, ceiling fans, furniture and dining tables**; budget split per category with a calculation table and remaining budget; links to Amazon, Flipkart, IKEA, Pepperfry, Myntra, Ajio.
- **Party Planner** — budget, guests, event type, venue, needs (catering / decoration / entertainment / cake / photography / gifts); links chosen per category (Swiggy & Zomato for food, BookMyShow for entertainment, OYO / Booking / MakeMyTrip / NoBroker / Google for venues, …).
- **Jewelry Planner** — budget, occasion, style, optional outfit photo (JPEG/PNG/WebP ≤ 5 MB) analysed by Gemini; links to Bluestone, Tanishq, CaratLane, Melorra, Amazon, Flipkart, Meesho.
- **Accounts & sessions** — register, login, logout, `/token`, `/session-info`, `/session-data`; idle sessions are purged by a background task (every 5 min, after 30 min idle).
- **History** — per-user plans, `/api/history`, `/recommendation-details/{id}`, clear history.
- **Fallbacks & validation** — if Gemini is missing, slow, over budget, or returns invalid JSON, a deterministic offline plan that always adds up to your budget is returned.
- **Ops** — `/startup` health endpoint, configurable CORS, security headers.

A full requirement-by-requirement table is in
[`docs/2. Requirement Analysis/SRS Traceability.md`](<docs/2. Requirement Analysis/SRS Traceability.md>).

## 2. Project structure

```
.
├── README.md
├── render.yaml                  # Render Blueprint (one web service; DB is Supabase)
├── .github/workflows/keep-alive.yml
├── vercel-proxy/                # Optional Vercel project that fronts the Render app
├── supabase/
│   └── schema.sql               # tables, FKs, constraints, indexes, RLS  <-- run once in Supabase
├── backend/
│   ├── app.py                   # app, CORS, middleware, shared routes, background cleanup
│   ├── auth.py                  # passwords, JWT, server-side sessions, cookies
│   ├── database.py              # SQLAlchemy tables + queries; Supabase-aware connection layer
│   ├── paths.py                 # where frontend/ lives
│   ├── models.py  planner_service.py  recommendations.py  enrichment.py
│   ├── routers/                 # auth, home, party, jewelry endpoints
│   ├── scripts/migrate_neon_to_supabase.py   # one-off data copy from the old Neon DB
│   ├── tests/test_app.py        # 28 tests
│   ├── requirements.txt
│   ├── .env                     # real settings (git-ignored)  – fill in your Supabase values
│   └── .env.example
├── frontend/
│   ├── templates/               # Jinja2 pages (unchanged)
│   ├── static/                  # CSS, JS, favicon (unchanged)
│   ├── .env                     # public Supabase values only
│   └── .env.example
└── docs/                        # original project-phase documents (reference only)
```

`render.yaml`, `.github/` and `vercel-proxy/` stay at the repository root because Render and GitHub look for them there.

---

## 3. Supabase setup (do this first)

### 3.1 Create the project and the tables

1. Create a project at https://supabase.com/dashboard (note the **Project name**, **Project URL** and region).
2. **SQL Editor → New query**, paste the whole of [`supabase/schema.sql`](supabase/schema.sql), **Run**.
   It is idempotent, so running it twice is harmless.
3. Verify (**Table Editor** shows `users`, `recommendations`, `sessions`, each with the RLS badge), or run the
   three verification queries at the bottom of the SQL file.

What the schema creates:

| Table | Purpose | Key constraints |
|---|---|---|
| `users` | accounts | identity PK; unique `lower(username)` and `lower(email)`; non-blank checks |
| `recommendations` | saved plans / history | PK uuid text; `user_id → users.id ON DELETE CASCADE`; `category IN (home, party, jewelry)`; `budget > 0`; index `(user_id, timestamp desc)` |
| `sessions` | server-side login sessions (JWT `jti`) | `user_id → users.id ON DELETE CASCADE`; indexes on `user_id`, `expires_at`, `last_activity` |

Timestamps are stored as ISO-8601 UTC **text**, exactly as the application writes and compares them, so the
column types match the application models and no business logic had to change.

### 3.2 Row Level Security — why the policies look the way they do

This app has its own authentication and talks to Postgres **directly from the backend** (role `postgres`,
which bypasses RLS). It does not use Supabase Auth or the Data API. But Supabase exposes every `public` table
to the browser-facing `anon`/`authenticated` roles through the Data API, and `users` contains password hashes.
So `schema.sql` applies defence in depth: RLS **enabled** on all three tables, an explicit **deny-all policy** for
`anon` and `authenticated`, and **all privileges revoked** from those roles. The publishable key therefore
cannot read or write anything. (`service_role`/the Secret key bypasses RLS by design — keep it server-side.)

If you later want browser clients to read their own data via Supabase Auth, replace the deny-all policy with
per-user policies; that needs a mapping from Supabase `auth.uid()` to `users.id`, which this app does not have.

### 3.3 Get the connection string

**Dashboard → Connect → Session pooler** (port `5432`). Use this one for Render or any always-on server:
the direct host `db.<ref>.supabase.co` is **IPv6-only** and fails on IPv4-only hosts. Use the **Transaction
pooler** (port `6543`) only for serverless/short-lived workers; the app disables prepared statements
automatically for both poolers.

```
postgresql://postgres.<PROJECT_REF>:<PASSWORD>@aws-0-<REGION>.pooler.supabase.com:5432/postgres
```

URL-encode special characters in the password (`@`→`%40`, `#`→`%23`, `/`→`%2F`, `:`→`%3A`).
`sslmode=require` is added automatically.

### 3.4 Fill in the environment files

Edit `backend/.env` (placeholders are marked `YOUR_…`):

| Variable | What to put |
|---|---|
| `SUPABASE_PROJECT_NAME` | your project name |
| `SUPABASE_URL` | `https://<ref>.supabase.co` |
| `SUPABASE_PUBLISHABLE_KEY` | `sb_publishable_…` (safe for browsers) |
| `SUPABASE_SECRET_KEY` | `sb_secret_…` — **server-side only**; not needed by the app itself |
| `DATABASE_URL` | the Session-pooler string from 3.3 — **this is what the backend actually uses** |
| `SECRET_KEY` | already generated for you (JWT signing); rotate if you like |

`frontend/.env` holds only the public URL and publishable key (the current pages do not read it).
Never put the Secret key in `frontend/` or in git.

### 3.5 (Existing users) Copy data from Neon

If the old Neon database holds real users/plans:

```bash
cd backend
export SOURCE_DATABASE_URL="postgresql://…neon.tech/…?sslmode=require"   # old database (read-only)
python scripts/migrate_neon_to_supabase.py --dry-run     # preview row counts
python scripts/migrate_neon_to_supabase.py               # copy users + recommendations
```

It preserves ids, is safe to re-run, and fixes the `users.id` sequence. Sessions are not copied by default
(people just log in again; add `--include-sessions` to copy them).

---

## 4. Run locally

Prerequisites: **Python 3.10+** (tested on 3.12).

```bash
cd backend
python -m venv .venv
source .venv/bin/activate            # Windows PowerShell: .venv\Scripts\Activate.ps1
pip install -r requirements.txt
uvicorn app:app --reload             # http://127.0.0.1:8000
```

Open http://127.0.0.1:8000/startup → expect `"status": "running"` and `"database": {"backend": "postgresql", "ok": true}`.

* `.env` sets `ENVIRONMENT=production` (Secure cookies). Chrome/Edge/Firefox accept them on `localhost`; for Safari
  or plain-HTTP LAN testing set `ENVIRONMENT=development`.
* Want a throw-away local database instead of Supabase? Leave `DATABASE_URL` empty → a SQLite file is created.
* With no `GEMINI_API_KEY` the app runs in **offline mode** (plans are labelled "Offline recommendation").
* Interactive API docs: http://127.0.0.1:8000/docs.

### Tests

```bash
python -m unittest discover -s backend/tests -p "test_*.py" -v
```

Expected: `Ran 28 tests ... OK`. The tests **always use a temporary SQLite file**, even if `backend/.env`
points at Supabase, so they can never touch production data. To run them against a *disposable* PostgreSQL:
`TEST_DATABASE_URL=postgresql://… python -m unittest …` (apply `supabase/schema.sql` to that database first).

---

## 5. Environment variables

| Variable | Required | Default | Purpose |
|---|---|---|---|
| `DATABASE_URL` | **Production** | *(empty → SQLite)* | Supabase PostgreSQL connection string (Session pooler) |
| `DB_AUTO_CREATE` | No | `false` | On PostgreSQL the app only *verifies* the tables. `true` lets it create them (without RLS — not advised) |
| `DB_POOL_SIZE` / `DB_MAX_OVERFLOW` | No | `5` / `5` | SQLAlchemy pool; keep within your Supabase pooler client limit |
| `DB_CONNECT_TIMEOUT` | No | `10` | Seconds to wait when connecting |
| `SECRET_KEY` | **Production** | random per start (dev only) | Signs login tokens |
| `ENVIRONMENT` | Recommended | `development` | `production` enforces `SECRET_KEY` and Secure cookies |
| `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY`, `SUPABASE_PROJECT_NAME`, `SUPABASE_SECRET_KEY` | No | — | Reference values (see 3.4); not read by the current code |
| `SOURCE_DATABASE_URL` | Migration only | — | Old Neon URL for `migrate_neon_to_supabase.py` |
| `DATABASE_PATH` | No | `backend/pocketsmart.sqlite3` | SQLite file when `DATABASE_URL` is empty |
| `FRONTEND_DIR` | No | `../frontend` | Location of templates/static |
| `GEMINI_API_KEY` | No | *(empty → offline mode)* | https://aistudio.google.com/apikey |
| `GEMINI_MODEL` / `GEMINI_FALLBACK_MODELS` / `GEMINI_TIMEOUT_SECONDS` | No | see `.env.example` | Model selection. Names change often — check https://ai.google.dev/gemini-api/docs/models |
| `ACCESS_TOKEN_EXPIRE_MINUTES` / `SESSION_IDLE_MINUTES` | No | `30` / `30` | Login lifetime / idle purge |
| `CORS_ORIGINS` | No | localhost origins | Comma-separated allowed origins (never `*`: cookies are used) |
| `COOKIE_SECURE` / `COOKIE_SAMESITE` | No | auto / `lax` | Override cookie flags only if needed |
| `HOST` / `PORT` | No | `127.0.0.1` / `8000` | Used by `python app.py` |

Never commit `.env` files; `.gitignore` excludes them.

---

## 6. Deploy

Two layouts: **A. Render only** (recommended start) or **B. Render + Vercel** front door. Push this repository to
GitHub first (the root must contain `render.yaml`).

### Part 1 — Backend on Render (database = Supabase)

1. Complete **§ 3** (schema run, connection string).
2. https://render.com → **New → Blueprint** → pick the repo. Render reads `render.yaml` and shows one web service.
3. When prompted, set **`DATABASE_URL`** (Session pooler string), `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY`, and
   optionally `GEMINI_API_KEY`. `SECRET_KEY` is generated for you.
4. **Apply**. Then open `https://<service>.onrender.com/startup` — expect `"status": "running"`, `"backend": "postgresql"`.

Manual setup instead of a Blueprint: **New → Web Service**, Build `pip install -r backend/requirements.txt`,
Start `cd backend && uvicorn app:app --host 0.0.0.0 --port $PORT --proxy-headers --forwarded-allow-ips="*"`,
Health check `/startup`, and add the env vars from § 5 (`ENVIRONMENT=production`, `SECRET_KEY`, `DATABASE_URL`).

Render free-tier facts: free web services **sleep after 15 minutes** idle (the included GitHub Action pings `/health`
every ~10 min; set repo variable `RENDER_URL` if your URL differs). Because the database is now on Supabase,
the old "free Render Postgres expires after 30 days" limit no longer applies; note that Supabase **free projects pause after 1 week of
inactivity** (restore from the dashboard) and have no scheduled backups — use a paid plan for important data.

### Part 2 — Vercel as the front door (optional)

`vercel-proxy/` forwards every request to Render, so visitors use one origin and cookies work without CORS.
Edit `vercel-proxy/vercel.json` to your Render URL, import the repo in Vercel with **Root Directory** `vercel-proxy`,
deploy, then set `CORS_ORIGINS` on Render to your Vercel URL. (Unchanged from before the migration.)

### Post-deploy checklist

- [ ] `/startup` → `status: running`, database `postgresql`, `ai_enabled: true` if you set a key
- [ ] Render logs have **no** "Row Level Security is OFF" warning (if they do, re-run `supabase/schema.sql`)
- [ ] Register → login → each planner → History → Logout works; rows appear in Supabase **Table Editor**
- [ ] Supabase **Advisors → Security** shows no "RLS disabled" errors for the three tables
- [ ] Publishable-key check: `curl "$SUPABASE_URL/rest/v1/users?select=*" -H "apikey: $SUPABASE_PUBLISHABLE_KEY"` returns
      an error/empty result, never rows

---

## 7. API reference

| Method & path | Auth | Description |
|---|---|---|
| `GET /`, `/login`, `/register` | — | Pages |
| `POST /register` | — | JSON `{username, password, email?, full_name?}` → 201 |
| `POST /token` | — | Form `username`, `password` → sets HttpOnly cookie, returns bearer token |
| `GET /logout`, `POST /logout` | — | Revokes the session server-side and clears the cookie |
| `GET /session-info` | ✔ | `username, login_time, last_activity, session_duration (min), user_data` |
| `GET /session-data`, `POST /session-data` | ✔ | Read / merge small session key-values (≤ 10 KB) |
| `GET /dashboard`, `/history`, `/home-planner`, `/party-planner`, `/jewelry-planner` | ✔ | Pages |
| `POST /generate-home` / `/generate-party` / `/generate-jewelry` | ✔ | Create and save a plan |
| `POST /recommendations-details` | ✔ | Generic plan endpoint `{category, budget, preferences}` |
| `GET /api/history`, `DELETE /api/history` | ✔ | List / clear your plans |
| `GET /recommendation-details/{id}` | ✔ | One stored plan (404 for other users' ids) |
| `GET /api/me` | ✔ | Current user |
| `GET /startup` | — | Health: status, AI on/off, database backend |

Auth accepts the cookie or `Authorization: Bearer <token>`.

## 8. Troubleshooting

| Symptom | Fix |
|---|---|
| `Cannot connect to the PostgreSQL database` at start-up | Re-copy `DATABASE_URL`. Use the **Session pooler** string; the direct `db.<ref>.supabase.co` host is IPv6-only. URL-encode special characters in the password |
| `password authentication failed` / `Tenant or user not found` | Wrong DB password, or the user is not `postgres.<PROJECT_REF>` (pooler requires the ref suffix). Reset the password in Project Settings → Database |
| `Database table(s) missing … run supabase/schema.sql` | Run `supabase/schema.sql` in the Supabase SQL editor, then restart |
| `prepared statement "_pg3_…" does not exist` | You are on the transaction pooler with a custom setup; use a `*.pooler.supabase.com` URL (handled automatically) or port 5432 |
| `remaining connection slots are reserved` / `max clients reached` | Lower `DB_POOL_SIZE` / `DB_MAX_OVERFLOW`, or use the Transaction pooler |
| Log warning `Row Level Security is OFF` | Re-run `supabase/schema.sql` |
| Supabase project "paused" | Free projects pause after a week idle: **Restore project** in the dashboard |
| `RuntimeError: SECRET_KEY must be set in production` | Set `SECRET_KEY` (Render Blueprint generates it) |
| Plans say "Offline recommendation" although a key is set | Check logs for `Gemini model … failed`; update `GEMINI_MODEL` and check quota |
| Logged out right after login on a custom setup | Cookies are `Secure` in production → use HTTPS; behind a proxy keep `--proxy-headers`. Local Safari: `ENVIRONMENT=development` |
| Render site very slow on first visit | Free service waking from sleep (~1 minute) |
| `ModuleNotFoundError` locally | Activate the venv and `pip install -r backend/requirements.txt` |

---

## 9. Security notes & known limitations

- Secrets come only from environment variables; `SECRET_KEY` is mandatory in production.
- Cookies are HttpOnly, `Secure` in production, `SameSite=Lax`. Logout revokes the session server-side.
- Shopping links are built only from a fixed platform whitelist; model output cannot inject URLs.
- Prices are **AI/offline planning estimates**, not live prices; the links are search links.
- No password-reset / e-mail verification flow (the SRS login mock-up shows a "Forgot password?" link; it needs an e-mail provider and is not implemented).
- No rate limiting; add one (e.g. at Vercel/Cloudflare) before public launch.
- Uploaded outfit images are analysed in memory and **not stored**.
- Do not commit API keys. If a key was ever pasted into a document or screenshot, revoke it in Google AI Studio and create a new one.
- Tables are protected by RLS + revoked grants (§ 3.2). Keep `SUPABASE_SECRET_KEY` and the database password out of git and out of `frontend/`.

## 10. Migration notes

What was changed (database integration + configuration only):

| Area | Change |
|---|---|
| `supabase/schema.sql` | **New.** Tables, FKs (`ON DELETE CASCADE`), unique/check constraints, indexes, RLS, deny-all policies, revoked `anon`/`authenticated` grants |
| `backend/database.py` | Same public functions/signatures. Added Supabase handling: `sslmode=require`, pooler detection (prepared statements off for Supavisor), connect timeout, configurable pool, **schema verification instead of `create_all()` on PostgreSQL** (so tables can never be auto-created without RLS), RLS-off warning, matching constraints/indexes for SQLite |
| `backend/paths.py`, `app.py`, `routers/*.py` | Template/static directories now resolve to `frontend/` (no logic change) |
| `backend/tests/test_app.py` | New paths; forced to SQLite so tests can never hit a production `DATABASE_URL` |
| `render.yaml` | Removed the Render-hosted PostgreSQL; `DATABASE_URL` now comes from Supabase; new paths |
| `.env` / `.env.example` | New for backend and frontend |
| `backend/scripts/migrate_neon_to_supabase.py` | **New.** One-off, idempotent data copy |
| Unchanged | All UI (`frontend/`), routes, validation, auth/session logic, AI/recommendation logic, `vercel-proxy/`, keep-alive workflow |

## 11. License

MIT — add a `LICENSE` file with your name before publishing.
