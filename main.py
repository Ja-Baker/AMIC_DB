"""
AMIC contact search — FastAPI app.

A single password-gated search page over the Supabase `hybrid_search_contacts` RPC.
Query embeddings are generated server-side with bge-base (fastembed); the database
connection lives only on the server, so no DB / service credentials touch the browser.

Env vars (set these in Railway):
  DATABASE_URL   Supabase *session pooler* connection string (IPv4-friendly)
  APP_PASSWORD   the shared password your client types to enter
  SECRET_KEY     random string used to sign the login cookie
  PORT           provided by Railway automatically
"""
import csv
import io
import os

from fastapi import FastAPI, Form, Request
from fastapi.responses import HTMLResponse, RedirectResponse, StreamingResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from fastapi.templating import Jinja2Templates
from starlette.middleware.sessions import SessionMiddleware

from fastembed import TextEmbedding
from psycopg_pool import ConnectionPool

MODEL_NAME = "BAAI/bge-base-en-v1.5"
HERE = os.path.dirname(os.path.abspath(__file__))

DATABASE_URL = os.environ.get("DATABASE_URL", "")
APP_PASSWORD = os.environ.get("APP_PASSWORD", "")
SECRET_KEY = os.environ.get("SECRET_KEY", "change-me-in-railway")

app = FastAPI(title="AMIC Contact Search")
app.add_middleware(SessionMiddleware, secret_key=SECRET_KEY, max_age=60 * 60 * 12)
app.mount("/static", StaticFiles(directory=os.path.join(HERE, "static")), name="static")
templates = Jinja2Templates(directory=os.path.join(HERE, "templates"))

# Loaded once at startup (model + a small connection pool).
_model: TextEmbedding | None = None
_pool: ConnectionPool | None = None


@app.on_event("startup")
def _startup():
    global _model, _pool
    _model = TextEmbedding(model_name=MODEL_NAME)
    _pool = ConnectionPool(DATABASE_URL, min_size=1, max_size=4, open=True)


def _authed(request: Request) -> bool:
    return bool(request.session.get("authed"))


def _embed_query(q: str) -> str | None:
    """bge query embedding as a pgvector literal, or None for filter-only browse."""
    q = (q or "").strip()
    if not q:
        return None
    vec = list(_model.query_embed([q]))[0].tolist()
    return "[" + ",".join(f"{x:.6f}" for x in vec) + "]"


def _norm(v):
    v = (v or "").strip() if isinstance(v, str) else v
    return v or None


POC_CHOICES = ["TH", "KM", "BW", "DS"]  # Tracy Henke, Kory Mathews, Brandon Wegge, Doug Stuart


def _run_search(q, tags, state, email_status, source, poc, include_dnc,
                semantic_weight, limit):
    params = {
        "qe": _embed_query(q),
        "q": _norm(q),
        "tags": tags or None,
        "state": _norm(state),
        "es": _norm(email_status),
        "src": _norm(source),
        "poc": _norm(poc),
        "dnc": bool(include_dnc),
        "sw": float(semantic_weight),
        "lim": int(limit),
    }
    sql = """
        select contact_id, last_name, first_name, full_name, organization, title,
               email, email_status, phone, linkedin, city, state, tags, source_lists,
               poc, do_not_contact, match_field
        from hybrid_search_contacts(
            query_embedding     => %(qe)s::vector,
            query_text          => %(q)s::text,
            filter_tags         => %(tags)s::text[],
            filter_state        => %(state)s::text,
            filter_email_status => %(es)s::text,
            filter_source       => %(src)s::text,
            filter_poc          => %(poc)s::text,
            include_dnc         => %(dnc)s::boolean,
            semantic_weight     => %(sw)s::real,
            match_count         => %(lim)s::int)
    """
    cols = ["contact_id", "last_name", "first_name", "full_name", "organization",
            "title", "email", "email_status", "phone", "linkedin", "city", "state",
            "tags", "source_lists", "poc", "do_not_contact", "match_field"]
    with _pool.connection() as conn, conn.cursor() as cur:
        cur.execute(sql, params)
        rows = cur.fetchall()
    return [dict(zip(cols, r)) for r in rows]


def _search_args(body):
    """Shared parameter parsing for /api/search and /api/export.csv."""
    return dict(
        q=body.get("q", ""),
        tags=body.get("tags") or None,
        state=body.get("state"),
        email_status=body.get("email_status"),
        source=body.get("source"),
        poc=body.get("poc"),
        include_dnc=bool(body.get("include_dnc")),
        semantic_weight=body.get("semantic_weight", 0.7),
    )


# ---------------------------------------------------------------- auth / pages
@app.get("/login", response_class=HTMLResponse)
def login_page(request: Request, error: str = ""):
    if _authed(request):
        return RedirectResponse("/", status_code=303)
    return templates.TemplateResponse("login.html", {"request": request, "error": error})


@app.post("/login")
def login_submit(request: Request, password: str = Form("")):
    if APP_PASSWORD and password == APP_PASSWORD:
        request.session["authed"] = True
        return RedirectResponse("/", status_code=303)
    return RedirectResponse("/login?error=Incorrect+password", status_code=303)


@app.get("/logout")
def logout(request: Request):
    request.session.clear()
    return RedirectResponse("/login", status_code=303)


@app.get("/", response_class=HTMLResponse)
def home(request: Request):
    if not _authed(request):
        return RedirectResponse("/login", status_code=303)
    return templates.TemplateResponse("search.html", {"request": request})


@app.get("/healthz")
def healthz():
    return {"ok": True}


# ---------------------------------------------------------------- api
@app.get("/api/meta")
def api_meta(request: Request):
    if not _authed(request):
        return JSONResponse({"error": "unauthorized"}, status_code=401)
    with _pool.connection() as conn, conn.cursor() as cur:
        cur.execute("select distinct state from contacts where state is not null order by 1")
        states = [r[0] for r in cur.fetchall()]
        cur.execute("""select t, count(*) c from contacts, unnest(tags) t
                       group by t order by c desc, t""")
        tags = [r[0] for r in cur.fetchall()]
        cur.execute("""select s, count(*) c from contacts, unnest(source_lists) s
                       group by s order by c desc, s""")
        sources = [r[0] for r in cur.fetchall()]
    return {"states": states, "tags": tags, "sources": sources,
            "email_statuses": ["valid format", "missing", "check"],
            "poc_choices": POC_CHOICES}


@app.post("/api/search")
async def api_search(request: Request):
    if not _authed(request):
        return JSONResponse({"error": "unauthorized"}, status_code=401)
    body = await request.json()
    rows = _run_search(**_search_args(body),
                       limit=min(int(body.get("limit", 50)), 200))
    return {"count": len(rows), "results": rows}


@app.post("/api/poc")
async def api_set_poc(request: Request):
    """Assign / clear a contact's POC. Editable inline from the results table."""
    if not _authed(request):
        return JSONResponse({"error": "unauthorized"}, status_code=401)
    body = await request.json()
    contact_id = _norm(body.get("contact_id"))
    poc = _norm(body.get("poc"))
    if not contact_id:
        return JSONResponse({"error": "missing contact_id"}, status_code=400)
    if poc is not None and poc not in POC_CHOICES:
        return JSONResponse({"error": "invalid poc"}, status_code=400)
    with _pool.connection() as conn, conn.cursor() as cur:
        cur.execute("update contacts set poc = %s where contact_id = %s",
                    (poc, contact_id))
        updated = cur.rowcount
    if not updated:
        return JSONResponse({"error": "unknown contact_id"}, status_code=404)
    return {"ok": True, "contact_id": contact_id, "poc": poc}


@app.post("/api/export.csv")
async def api_export(request: Request):
    if not _authed(request):
        return JSONResponse({"error": "unauthorized"}, status_code=401)
    body = await request.json()
    rows = _run_search(**_search_args(body),
                       limit=min(int(body.get("limit", 1000)), 2000))
    fields = ["contact_id", "last_name", "first_name", "full_name", "organization",
              "title", "email", "email_status", "phone", "linkedin", "city", "state",
              "tags", "source_lists", "poc", "do_not_contact"]
    buf = io.StringIO()
    w = csv.writer(buf)
    w.writerow(fields)
    for r in rows:
        row = dict(r)
        row["tags"] = "; ".join(row.get("tags") or [])
        row["source_lists"] = "; ".join(row.get("source_lists") or [])
        row["do_not_contact"] = "yes" if row.get("do_not_contact") else ""
        w.writerow(["" if row.get(f) is None else row.get(f) for f in fields])
    # Prepend a UTF-8 BOM so Excel renders accents/emoji correctly.
    data = "﻿" + buf.getvalue()
    return StreamingResponse(
        iter([data]),
        media_type="text/csv",
        headers={"Content-Disposition": "attachment; filename=amic_contacts.csv"},
    )
