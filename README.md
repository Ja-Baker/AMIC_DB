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
| `HUNTER_API_KEY` | *(optional)* Hunter.io key for the email-finder's API arm. Leave unset to run the free local pattern-guess only. |

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

## Bulk import (`/import`)

A 4-step wizard (top-bar **↥ Import contacts**) for loading large batches:

1. **Upload** a CSV or `.xlsx` (parsed in the browser — nothing is saved yet).
2. **Map columns** — headers are auto-matched to fields; fix any and set a
   batch/source label that gets stamped onto every imported contact's `source_lists`.
3. **Review** — the server flags new vs. likely-duplicate rows (matched by email, or
   name + organization). Choose **skip dupes / merge blanks / import everything**.
4. **Import** — rows are written to `contacts` with fresh `C####` ids and **embedded
   server-side** (the app's in-memory bge-base model), so new contacts are searchable
   immediately. Progress streams via a background job. Merges are logged to `merge_log`.

## Find missing emails

Select contacts with no email → **✉ Find emails**. For each, the finder pulls the
company domain from the linked org's website and resolves a best-guess address:
Hunter.io when `HUNTER_API_KEY` is set (returns a confidence score), otherwise a
local pattern guess (`first.last@domain`, etc.). Results are written with
`email_status = 'check'` and provenance (`email_source`, `email_confidence`) so they
are flagged for a human to confirm before a send — they never masquerade as verified.

(SMTP address verification is intentionally not used: Railway, like most hosts,
blocks outbound port 25, so it could never run in production. Set `HUNTER_API_KEY`
for verified results; without it the finder still gives confirm-before-send guesses.)

## Export formats (Microsoft-friendly)

The **⬇ Export** menu exports the selected rows (or the whole result set), with
toggles for *only-with-email* and *dedupe addresses*:

- **Outlook mail-merge (Excel)** — First/Last, a ready **Greeting** column, Email, Org,
  Title, Location; one row per person. Drops into Word/Outlook mail merge.
- **Outlook contacts (CSV)** — the exact headers Outlook's *Import Contacts* expects.
- **Plain CSV** — all columns, general use.
- **Copy BCC list** — semicolon-joined addresses for a quick small send.

> Exchange Online caps ~500 recipients/message and ~10k/day — for multi-thousand
> event blasts use the mail-merge sheet (sends individually), not one big BCC.
