# Installation Guide

The complete, maintained guide (local setup, environment variables, Supabase database, Render and
Vercel) is the repository-root `README.md`.

Quick start (PowerShell, from the repository root):

```powershell
Set-Location backend
python -m venv .venv
.venv\Scripts\Activate.ps1
pip install -r requirements.txt
Copy-Item .env.example .env      # then fill in DATABASE_URL etc.
uvicorn app:app --reload
```

Run `supabase/schema.sql` once in the Supabase SQL editor before the first start.
Leave `DATABASE_URL` empty to use a local SQLite file instead.
Set a stable `SECRET_KEY` to keep logins valid across restarts.
