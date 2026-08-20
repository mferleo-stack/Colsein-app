# Colsein App

React + Vite implementation of the `Colsein App.dc.html` design, wired to Supabase.

## Setup

```bash
cd app
npm install
cp .env.example .env   # fill in VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY
```

In your Supabase project's SQL Editor, run `sql/schema.sql` once — it creates `usuarios` and `tickets` (with the FK, RLS policies, and realtime publication), and seeds the two demo users plus a few sample tickets. It starts by dropping any existing `usuarios`/`tickets` tables, so only run it against a test project.

```bash
npm run dev
```

## What's wired to Supabase

- **Login screen** (`src/App.jsx`) has no credentialed auth — the two "Acceso rápido" buttons set the demo user directly (`DEMO_CLIENT_ID` / `DEMO_ADMIN_ID`, seeded by `sql/schema.sql`).
- **Incident form** (`Form Step 1/2` → AI triage → `confirmSubmit`) inserts a row into `tickets` with `usuario_id: DEMO_CLIENT_ID`.
- Logging in as Admin runs a `select('*')` on `tickets` and subscribes to Postgres Changes, so the KPI row, both bar charts, the division treemap, and the Tablero (Kanban-style groups) all update live as rows change.
- Changing a ticket's status or marking one urgent issues a Supabase `update`.

## Deploying

```bash
npm install -g vercel
vercel login
vercel link       # pick your team/scope, and either an existing project or create a new one
vercel --prod
```

After the first deploy, set `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` in the Vercel project's Settings → Environment Variables (these are baked in at build time, not read from `.env` on Vercel), then redeploy with `vercel --prod` again so the build picks them up.
