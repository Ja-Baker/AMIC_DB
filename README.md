# AMIC Contact Search

A simple, password-gated web app for searching the AMIC contact database (~1,600
St. Louis manufacturing/civic contacts) to build outreach and event-invite lists.
The client types a natural-language query (plus optional filters), the server
embeds it with bge-base and calls the Supabase `hybrid_search_contacts` RPC, and
results can be exported to CSV.

This repo is the **deployable app** — it builds from the root via the `Dockerfile`.
The database, schema, and embedding pipeline live elsewhere; this app only talks to
the existing `hybrid_search_contacts` RPC. No database credentials ever reach the
browser; access is gated by a single shared password.

## Contents
```
main.py              FastAPI app: login, /api/search, /api/export.csv, /api/meta
templates/           login.html, search.html
static/              style.css, app.js
requirements.txt     Python deps
Dockerfile           pre-bakes the bge-base model for fast cold starts
railway.json         Railway build/deploy config (uses the Dockerfile)
.env.example         env vars to set
```

## Environment variables
| Var | What |
|-----|------|
| `DATABASE_URL` | Supabase **Session pooler** connection string (Dashboard → Connect → Session pooler), with the real password. IPv4-friendly, which Railway needs. |
| `APP_PASSWORD` | The password your client types to enter. |
| `SECRET_KEY`   | Random string to sign the login cookie. Generate with `openssl rand -hex 32`. |
| `PORT`         | Set automatically by Railway — do not set it yourself. |

## Deploy to Railway

Because the `Dockerfile` and `railway.json` are at the repo root, **no Root
Directory setting is needed** — Railway builds the Dockerfile directly.

**From GitHub:** Railway → New Project → Deploy from GitHub repo → pick
`Ja-Baker/AMIC_DB` → add the three Variables above → deploy. Then **Settings →
Networking → Generate Domain** for a public URL.

**From the CLI:**
```bash
npm i -g @railway/cli && railway login
railway init && railway up
railway variables --set "DATABASE_URL=postgresql://postgres.sawwgimqhmjoihflgzjw:PASS@aws-1-us-east-2.pooler.supabase.com:5432/postgres" \
                  --set "APP_PASSWORD=your-strong-password" \
                  --set "SECRET_KEY=$(openssl rand -hex 32)"
railway domain
```

Notes: the first build downloads the embedding model into the image (a few
minutes); give the service ~1 GB RAM. Healthcheck path is `/healthz`.

## Run locally
```bash
python3 -m venv .venv
./.venv/bin/pip install -r requirements.txt
cp .env.example .env          # fill in DATABASE_URL / APP_PASSWORD / SECRET_KEY
set -a; . ./.env; set +a
./.venv/bin/python -m uvicorn main:app --reload --port 8077
# open http://127.0.0.1:8077
```

## Using it
- **Search box**: natural language — "workforce development", "CNC machining
  apprenticeship", "robotics automation". Ranked by rank-fusion (RRF) of meaning
  (vector) + exact keywords, so literal matches (a company name, an acronym) reliably
  surface at the top instead of being buried under fuzzy semantic matches.
- **Match column**: each row shows *why* it matched — `name` / `org` / `title` for an
  exact text hit, or `related` when found by meaning only.
- **Filters**: state, email status, tags (match any), source list. Leave the search
  box empty to browse purely by filters.
- **POC**: each result row has an editable **POC** (AMIC point of contact) dropdown —
  TH / KM / BW / DS. Picking one saves immediately to the database; pick the blank to
  clear it. Filter by POC, or by "include do-not-contact", from the sidebar.
- **Advanced**: semantic-vs-keyword weight slider, max results.
- **Export CSV**: downloads the current result set (last name, first name, organization,
  title, contact details, source lists, POC, do-not-contact) for outreach. Tick rows to
  export only the selected contacts.
- **Saved lists**: tick contacts, then **Lists → New list from selection** to save a named,
  reusable outreach list. Reopen a list any time to view/export it, add or remove the
  current selection, rename it, or delete it. Lists persist in the database
  (`contact_lists` / `contact_list_members`).
