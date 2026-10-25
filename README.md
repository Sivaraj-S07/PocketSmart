# PocketSmart AI — React + Express + Supabase

AI-assisted budget planner for **home interiors, parties and jewelry**. Sign up, enter a budget, and get a
category-by-category plan with shopping links for Indian platforms (Amazon, Flipkart, IKEA, Swiggy, Zomato,
Tanishq …). Plans use Google Gemini when a key is configured and fall back to deterministic offline plans
otherwise, so the app always works.

This is a **100 % JavaScript stack** (it was Python/FastAPI + Jinja templates before):

| Layer     | Technology                                                       |
|-----------|------------------------------------------------------------------|
| Frontend  | React 19, React Router, Vite                                     |
| Backend   | Node.js 20+, Express 5, `pg`, bcrypt, JWT                        |
| Database  | Supabase (PostgreSQL) — same tables as before (`supabase/schema.sql`) |
| AI        | Google Gemini via `@google/genai` (optional)                     |

```
PocketSmart/
├── package.json            root scripts (dev / build / start / test)
├── render.yaml             one-service Render blueprint (API + built React app)
├── supabase/schema.sql     database schema + Row Level Security  (run once)
├── backend/                Express API
│   ├── src/                app, routes, auth, db, recommendation engine
│   ├── tests/              41 tests (in-process Postgres, zero setup)
│   ├── scripts/            migrate-neon-to-supabase.js
│   └── .env.example
├── frontend/               React app (Vite)
│   ├── src/pages/          Home, Login, Register, Dashboard, HomePlanner, PartyPlanner, JewelryPlanner, History
│   ├── src/styles/         the original page stylesheets, unchanged
│   ├── vercel.json, public/_redirects   optional Vercel / Netlify hosting
│   └── .env.example
├── .github/workflows/keep-alive.yml
└── docs/                   original project documents
```

---

## 1. Quick start (local)

**Requirements:** Node.js 20 or newer (`node -v`) and a free [Supabase](https://supabase.com) project.

### a) Create the database tables (once)
1. Supabase Dashboard → **SQL Editor** → New query.
2. Paste the contents of [`supabase/schema.sql`](supabase/schema.sql) → **Run**.
   (Already have the tables from the old version? Skip this — the same schema is reused, your data keeps working.)

### b) Configure the backend
```bash
cp backend/.env.example backend/.env        # Windows: copy backend\.env.example backend\.env
```
Open `backend/.env` and set **`DATABASE_URL`**:

Supabase Dashboard → **Connect** → **Session pooler** → copy the URI, replace `[YOUR-PASSWORD]`.
If the password has special characters, URL-encode them (`@`→`%40`, `#`→`%23`, `/`→`%2F`, `:`→`%3A`).

Optional: `GEMINI_API_KEY` (free key at <https://aistudio.google.com/apikey>). Without it you get offline plans.
Leave `ENVIRONMENT=development` for local work.

### c) Install and run
```bash
npm run install:all     # installs root, backend and frontend dependencies
npm run dev             # API on :8000, React dev server on :5173
```
Open **http://localhost:5173**, register an account, and start planning.

In development Vite proxies `/api/*` to the Express server, so the browser only talks to one origin
(cookies just work, no CORS setup).

### Run it as production locally (single server)
```bash
npm run build           # builds frontend/dist
npm start               # Express serves the API *and* the built React app on http://localhost:8000
```

### Tests
```bash
npm test                # backend (node:test) + frontend (vitest)
```
Backend tests use an in-process PostgreSQL (PGlite), so nothing needs to be installed or configured. To run them
against a real **disposable** database instead: `TEST_DATABASE_URL=postgresql://… npm test --prefix backend`
(its tables are emptied — never point it at production).

---

## 2. Deployment

### Option A — Render only (recommended, simplest)
One Render web service builds the React app and serves it together with the API (same origin, no CORS, no proxy).

1. Push this folder to GitHub.
2. Render → **New → Blueprint** → select the repo (uses `render.yaml`).
3. When prompted, set **`DATABASE_URL`** (Supabase *Session pooler* URI — IPv4-compatible, which Render's free tier needs)
   and optionally **`GEMINI_API_KEY`**. `SECRET_KEY` is generated for you.
4. Deploy. Health check: `/health`.

> Reusing your existing Render service? Keep its current `SECRET_KEY` and existing logins/passwords stay valid
> (password hashes and tokens are compatible with the previous Python backend).
> Change the service's **Build Command** to `npm run render:build` and **Start Command** to `npm start`, and
> set `NODE_VERSION=22`.

Free Render services sleep after 15 minutes. `.github/workflows/keep-alive.yml` pings `/health` every 10 minutes
(set the repo variable `RENDER_URL` to your service URL).

### Option B — React on Vercel/Netlify, API on Render
Deploy the API as in Option A, then host `frontend/` separately:

* **Vercel:** import the repo, set *Root Directory* = `frontend`. `frontend/vercel.json` proxies `/api/*` to Render.
* **Netlify:** base directory `frontend`, build `npm run build`, publish `dist`. `frontend/public/_redirects` does the same.

Both configs point at `https://pocketsmartai-7n55.onrender.com` — **replace it with your own Render URL.**
Because `/api` is proxied, the browser still sees a single origin and the HttpOnly login cookie works everywhere
(Safari included). Direct cross-origin calls (`VITE_API_URL`) are possible but need third-party cookies; see
`frontend/.env.example`.

---

## 3. Environment variables

**Backend** (`backend/.env`; full list with comments in `.env.example`)

| Variable | Purpose |
|---|---|
| `DATABASE_URL` | **Required.** Supabase *Session pooler* connection string |
| `SECRET_KEY` | JWT signing key. **Required in production** (the server refuses to start without it) |
| `ENVIRONMENT` | `production` → Secure cookies + enforced `SECRET_KEY`; `development` for local |
| `GEMINI_API_KEY` | Optional. Enables Gemini plans; offline plans otherwise |
| `GEMINI_MODEL`, `GEMINI_FALLBACK_MODELS` | Model chain, tried in order (names change — check ai.google.dev) |
| `CORS_ORIGINS` | Only for a frontend on a different origin |
| `DB_AUTO_CREATE` | `true` runs `supabase/schema.sql` at start-up (default: only verify the tables exist) |
| `PORT`, `HOST` | Default `8000`; host `127.0.0.1` locally, `0.0.0.0` in production |

**Frontend** (`frontend/.env`, optional): `VITE_DEV_API_TARGET` (dev proxy target), `VITE_API_URL` (leave empty).

---

## 4. API reference

All JSON endpoints live under `/api`. Authentication is an HttpOnly cookie set at login (an
`Authorization: Bearer <token>` header also works). Errors are `{ "detail": … }`.

| Method | Path | Notes |
|---|---|---|
| POST | `/api/register` | `{username, password, email?, full_name?}` → 201 |
| POST | `/api/token` | `{username, password}` (JSON or form) → sets cookie, returns token |
| POST | `/api/logout` | revokes the session, clears the cookie → 204 |
| GET | `/api/me` | current user |
| GET / POST | `/api/session-data` | small per-session key/values (≤ 10 KB) |
| GET | `/api/session-info` | session timing details |
| POST | `/api/generate-home` · `-party` · `-jewelry` | create a plan (saved to history) |
| POST | `/api/recommendations-details` | generic `{category, budget, preferences}` |
| GET / DELETE | `/api/history` | list (newest first) / clear |
| GET | `/api/recommendation-details/:id` | full stored plan (own plans only) |
| GET | `/health`, `/startup` (also under `/api/`) | liveness / status incl. database |

**Mapping from the previous Python version:** every JSON route simply gained the `/api` prefix
(`/token` → `/api/token`, `/generate-home` → `/api/generate-home`, …). Pages (`/login`, `/dashboard`, …) are now
React routes.

---

## 5. Moving data from Neon
Only needed if you still have users/history in the old Neon database:
```bash
cd backend
SOURCE_DATABASE_URL="postgresql://…neon.tech/neondb?sslmode=require" npm run migrate:neon -- --dry-run
SOURCE_DATABASE_URL="…" npm run migrate:neon
```
Safe to re-run (existing rows are skipped), preserves user ids and never writes to the source.

---

## 6. Troubleshooting

| Symptom | Fix |
|---|---|
| `DATABASE_URL is not set` | Create `backend/.env` from `.env.example` |
| `Cannot connect to the PostgreSQL database` | Use the **Session pooler** string (the `db.<ref>.supabase.co` host is IPv6-only); URL-encode the password; check the Supabase project isn't paused |
| `Database table(s) missing` | Run `supabase/schema.sql` in the Supabase SQL editor |
| `SECRET_KEY must be set in production` | Set it (Render generates one from `render.yaml`) |
| Login works but you're sent back to sign-in (HTTPS site) | Make sure `/api` goes through the same origin (Option A, or the Vercel/Netlify rewrite) |
| Safari on `http://localhost` doesn't stay logged in | Safari rejects Secure cookies on http — use `ENVIRONMENT=development` (default in `.env.example`) |
| First request after a while is slow / 502 | Free Render instance was asleep — enable the keep-alive workflow |
| Plans always say "Offline recommendation" | No `GEMINI_API_KEY`, or the model names in `.env` are retired; the server log shows which model failed |

---

## 7. Behaviour changes and fixes made during the conversion

* **Recent activity (Dashboard) and History showed the *oldest* plans first.** The API returns newest first but the
  page then reversed or tail-sliced it. Both now show newest first.
* **Single-page app:** page navigation no longer reloads; one login check (`/api/me`) replaces the old
  `localStorage` username workaround. The login token is never stored in JavaScript-readable storage.
* **Unknown `/api/*` paths return JSON 404**, and a missing `/assets/*` file returns 404 rather than the app shell
  (prevents confusing "Unexpected token <" errors after a redeploy).
* **Bug fixed in config:** `vercel.json` proxied to a different Render host than the keep-alive workflow pings.
  Both now use one host (edit to yours).
* **Removed unused settings:** `SUPABASE_URL` / `SUPABASE_PUBLISHABLE_KEY` were never read by the code.
  SQLite fallback removed (the app is Supabase/PostgreSQL only); `styles.css` was unused and dropped.
* The Neon migration script is now JavaScript (`npm run migrate:neon`).
* Unchanged on purpose: all page markup/CSS, the plan-generation rules, offline fallback maths, shopping-link
  whitelist, validation limits, session lifetime (30 min sliding), bcrypt/JWT formats, and the database schema.
