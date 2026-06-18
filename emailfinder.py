"""
Email finder — Railway-compatible. Two arms, both of which work behind a normal
cloud host (no outbound port 25 required):

  1. local pattern guess  — derive the most likely address from the person's name
     and the company domain (first.last@, flast@, ...). Cheap, no network, but
     UNVERIFIED — returned with low confidence for a human to confirm.
  2. Hunter.io fallback   — when HUNTER_API_KEY is set, an HTTPS lookup that
     returns a best email + confidence score. This is the accuracy driver.

SMTP/MX verification was deliberately left out: Railway (and most clouds) block
outbound port 25, so it could never run in production and would only ever return
"unknown". Every address this module returns is a *candidate* — callers store it
with email_status='check' so it's flagged for review before any send.
"""
from __future__ import annotations

import os
import re
import unicodedata
from dataclasses import dataclass, asdict

import httpx

HUNTER_API_KEY = os.environ.get("HUNTER_API_KEY", "")
_EMAIL_RE = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")


@dataclass
class Found:
    email: str
    confidence: float          # 0..1
    source: str                # 'hunter' | 'pattern'
    verified: bool             # Hunter high-score; pattern guesses are never verified
    detail: str = ""           # human-readable note for the UI

    def as_dict(self):
        return asdict(self)


# ----------------------------------------------------------------- name / domain
def _ascii(s: str) -> str:
    """Lowercase, strip accents, keep a-z only (for building local-parts)."""
    s = unicodedata.normalize("NFKD", s or "")
    s = "".join(c for c in s if not unicodedata.combining(c))
    return re.sub(r"[^a-z]", "", s.lower())


def split_name(first: str | None, last: str | None, full: str | None) -> tuple[str, str]:
    """Best-effort (first, last) ascii tokens from whatever the row has."""
    f, l = _ascii(first or ""), _ascii(last or "")
    if not (f and l) and full:
        parts = [p for p in re.split(r"\s+", full.strip()) if p and not p.startswith("(")]
        if len(parts) >= 2:
            f = f or _ascii(parts[0])
            l = l or _ascii(parts[-1])
        elif len(parts) == 1:
            f = f or _ascii(parts[0])
    return f, l


def domain_from_website(website: str | None) -> str | None:
    """Normalize a stored website (bare 'acme.com' or a full URL) to a domain."""
    w = (website or "").strip().lower()
    if not w:
        return None
    w = re.sub(r"^https?://", "", w)
    w = w.split("/")[0].split("?")[0].split("@")[-1]
    if w.startswith("www."):
        w = w[4:]
    if "." not in w or " " in w:
        return None
    return w or None


def candidate_locals(first: str, last: str) -> list[str]:
    """Common corporate local-part patterns, most-likely first (deduped)."""
    f, l = first, last
    fi, li = (f[:1] if f else ""), (l[:1] if l else "")
    pats = []
    if f and l:
        pats += [f"{f}.{l}", f"{fi}{l}", f"{f}{l}", f"{f}_{l}",
                 f"{f}-{l}", f"{f}.{li}", f"{fi}.{l}", f"{l}.{f}", f"{l}{fi}"]
    if f:
        pats.append(f)
    if l:
        pats.append(l)
    seen, out = set(), []
    for p in pats:
        if p and p not in seen:
            seen.add(p)
            out.append(p)
    return out


# ----------------------------------------------------------------- Hunter.io
def find_hunter(first: str, last: str, domain: str, api_key: str) -> Found | None:
    if not api_key:
        return None
    try:
        r = httpx.get(
            "https://api.hunter.io/v2/email-finder",
            params={"domain": domain, "first_name": first, "last_name": last,
                    "api_key": api_key},
            timeout=10.0,
        )
        if r.status_code != 200:
            return None
        data = r.json().get("data") or {}
        email = data.get("email")
        if not email or not _EMAIL_RE.match(email):
            return None
        conf = (data.get("score") or 0) / 100.0
        return Found(email=email, confidence=round(conf, 2), source="hunter",
                     verified=conf >= 0.9, detail=f"Hunter score {data.get('score')}")
    except Exception:
        return None


# ----------------------------------------------------------------- orchestrator
def find_email(first: str | None, last: str | None, full_name: str | None,
               domain: str | None, *, hunter_key: str | None = None) -> Found | None:
    """
    Resolve a best-guess email for one person. Hunter (when configured) is tried
    first because it's the only arm that can actually confirm an address; the
    local pattern guess is the fallback. Returns None when there's no company
    domain to build on.
    """
    domain = domain_from_website(domain)  # accept a raw URL/website too
    if not domain:
        return None
    hunter_key = HUNTER_API_KEY if hunter_key is None else hunter_key
    f, l = split_name(first, last, full_name)

    hit = find_hunter(f, l, domain, hunter_key)
    if hit:
        return hit

    cands = candidate_locals(f, l)
    if cands:
        return Found(email=f"{cands[0]}@{domain}", confidence=0.3, source="pattern",
                     verified=False, detail="pattern guess — confirm before sending")
    return None
