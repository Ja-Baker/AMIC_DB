"use strict";
// Email Finder tab: full hybrid search (defaulting to missing-email contacts) +
// a finder that fills addresses via Hunter.io (API key) or local pattern-guessing.

const $ = (id) => document.getElementById(id);
let table = null;
const ts = {};

function esc(s) {
  return (s == null ? "" : String(s)).replace(/[&<>"]/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
}
const dash = (v) => esc(v) || "<span class='muted'>—</span>";

// ---------------------------------------------------------------- formatters
function emailFmt(cell) {
  const e = cell.getValue();
  const st = cell.getRow().getData().email_status || "";
  if (!e) return `<span class="pill err">missing</span>`;
  const cls = st === "valid format" ? "new" : st === "check" ? "dupe" : "new";
  const tag = st === "check" ? "check" : st === "valid format" ? "ok" : st;
  return `<a class="email" href="mailto:${esc(e)}">${esc(e)}</a> ` +
         `<span class="pill ${cls}">${esc(tag)}</span>`;
}
function confFmt(cell) {
  const v = cell.getValue();
  if (v == null || v === 0) return "<span class='muted'>—</span>";
  const pct = Math.round(v * 100);
  const cls = v >= 0.8 ? "new" : v >= 0.4 ? "dupe" : "err";
  return `<span class="pill ${cls}">${pct}%</span>`;
}
function srcFmt(cell) {
  const s = cell.getValue();
  return s ? `<span class="muted sm">${esc(s)}</span>` : "<span class='muted'>—</span>";
}

function buildTable() {
  table = new Tabulator("#grid", {
    index: "contact_id",
    layout: "fitDataFill",
    height: "calc(100dvh - 232px)",
    placeholder: "<div class='empty'><strong>No contacts loaded</strong>" +
      "<span>Search on the left (defaults to contacts missing an email), then " +
      "select rows and hit “Find emails”.</span></div>",
    selectableRows: true,
    columnDefaults: { headerHozAlign: "left", resizable: true },
    columns: [
      { formatter: "rowSelection", titleFormatter: "rowSelection", hozAlign: "center",
        headerSort: false, width: 42, frozen: true },
      { title: "Last name", field: "last_name", minWidth: 130, frozen: true,
        formatter: (c) => `<strong>${dash(c.getValue())}</strong><div class="muted sm">${esc(c.getRow().getData().contact_id)}</div>` },
      { title: "First name", field: "first_name", minWidth: 110, formatter: (c) => dash(c.getValue()) },
      { title: "Organization", field: "organization", minWidth: 190, formatter: (c) => dash(c.getValue()) },
      { title: "Title", field: "title", minWidth: 160, formatter: (c) => dash(c.getValue()) },
      { title: "Email", field: "email", minWidth: 250, formatter: emailFmt },
      { title: "Conf.", field: "email_confidence", width: 80, hozAlign: "center", formatter: confFmt },
      { title: "Source", field: "email_source", width: 100, hozAlign: "center", formatter: srcFmt },
    ],
  });
  table.on("rowSelectionChanged", (data) => updateSel(data.length));
}

function updateSel(n) {
  $("selCount").hidden = n === 0;
  $("selCount").textContent = `${n} selected`;
  $("acceptBtn").hidden = n === 0;
  $("clearBtn").hidden = n === 0;
}
function selectedIds() {
  return (table ? table.getSelectedData() : []).map((d) => d.contact_id);
}
function resultIds() {
  const sel = table ? table.getSelectedData() : [];
  const rows = sel.length ? sel : (table ? table.getData() : []);
  return rows.map((d) => d.contact_id);
}

// ---------------------------------------------------------------- search
function gatherParams() {
  const sv = (n) => (ts[n] ? ts[n].getValue() : "") || null;
  return {
    q: $("q").value,
    email_status: sv("email_status"),
    state: sv("state"),
    source: sv("source"),
    tags: (ts.tags ? ts.tags.getValue() : []).length ? ts.tags.getValue() : null,
    semantic_weight: 0.5,
    limit: 200,
  };
}
async function search() {
  $("searchBtn").setAttribute("aria-busy", "true");
  $("status").textContent = "Searching…";
  try {
    const res = await fetch("/api/search", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify(gatherParams()),
    });
    if (res.status === 401) { window.location = "/login"; return; }
    const data = await res.json();
    await table.setData(data.results || []);
    const miss = (data.results || []).filter((r) => !r.email).length;
    $("status").textContent = data.count
      ? `${data.count} contact${data.count === 1 ? "" : "s"} · ${miss} missing email`
      : "No contacts matched.";
  } catch (e) {
    $("status").textContent = "Search failed: " + e;
  } finally {
    $("searchBtn").removeAttribute("aria-busy");
  }
}
function resetFilters() {
  $("q").value = "";
  ["email_status", "state", "source"].forEach((n) => ts[n] && ts[n].clear());
  ts.tags && ts.tags.clear();
  if (ts.email_status) ts.email_status.setValue("missing");
  table.clearData();
  $("status").textContent = "Search to load contacts, then find emails.";
}

// ---------------------------------------------------------------- find / apply
async function api(url, body) {
  const res = await fetch(url, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body || {}),
  });
  if (res.status === 401) { window.location = "/login"; throw new Error("auth"); }
  if (!res.ok) { const e = await res.json().catch(() => ({})); throw new Error(e.error || "request failed"); }
  return res.json();
}

async function findEmails() {
  const ids = resultIds();
  if (!ids.length) { flash("Search for contacts first", true); return; }
  const selecting = (table.getSelectedData().length > 0);
  const scope = selecting ? `${ids.length} selected` : `all ${ids.length} shown`;
  if (!confirm(`Find emails for ${scope} contact(s)? Only those missing an email are looked up.`)) return;
  $("findBtn").setAttribute("aria-busy", "true");
  try {
    const { job } = await api("/api/email/find", {
      contact_ids: ids,
      hunter_key: $("hunterKey").value.trim() || null,
      local_only: $("localOnly").checked,
      min_confidence: parseFloat($("minConf").value) || 0,
    });
    pollJob(job);
  } catch (e) {
    flash(e.message, true);
    $("findBtn").removeAttribute("aria-busy");
  }
}
async function pollJob(job) {
  const res = await fetch("/api/jobs/" + job);
  if (res.status === 401) { window.location = "/login"; return; }
  const j = await res.json();
  if (j.message) $("status").textContent = j.message;
  if (j.status === "running") { setTimeout(() => pollJob(job), 700); return; }
  $("findBtn").removeAttribute("aria-busy");
  if (j.status === "error") { flash(j.error || "Find failed", true); return; }
  const r = j.result || {};
  flash(`Found ${r.found} email${r.found === 1 ? "" : "s"} (${r.skipped_low || 0} below threshold, ${r.no_match || 0} no match)`);
  search(); // refresh grid from DB so the new emails + scores show
}

async function applyAction(action) {
  const ids = selectedIds();
  if (!ids.length) return;
  const verb = action === "accept" ? "Accept (mark verified)" : "Clear emails on";
  if (!confirm(`${verb} ${ids.length} contact(s)?`)) return;
  try {
    const r = await api("/api/email/apply", { contact_ids: ids, action });
    flash(`${action === "accept" ? "Accepted" : "Cleared"} ${r.updated}`);
    search();
  } catch (e) { flash(e.message, true); }
}

// ---------------------------------------------------------------- toast
let flashTimer = null;
function flash(msg, bad) {
  let el = $("toast");
  if (!el) { el = document.createElement("div"); el.id = "toast"; document.body.appendChild(el); }
  el.textContent = msg;
  el.className = "toast show" + (bad ? " bad" : "");
  clearTimeout(flashTimer);
  flashTimer = setTimeout(() => { el.className = "toast"; }, 2200);
}

// ---------------------------------------------------------------- meta / init
async function loadMeta() {
  const res = await fetch("/api/meta");
  if (!res.ok) return;
  const m = await res.json();
  for (const v of m.email_statuses) $("email_status").add(new Option(v, v));
  for (const v of m.states) $("state").add(new Option(v, v));
  for (const v of m.sources) $("source").add(new Option(v, v));
  for (const t of m.tags) $("tags").add(new Option(t, t));

  const single = { create: false, allowEmptyOption: true, controlInput: null };
  ts.email_status = new TomSelect("#email_status", single);
  ts.state = new TomSelect("#state", single);
  ts.source = new TomSelect("#source", single);
  ts.tags = new TomSelect("#tags", { create: false, plugins: ["remove_button"], maxOptions: 500 });
  ts.email_status.setValue("missing");   // sensible default for this tab
  search();                               // auto-load the missing-email worklist
}

function init() {
  buildTable();
  loadMeta();
  // restore a previously-entered API key (this browser only)
  const saved = localStorage.getItem("amic_hunter_key");
  if (saved) $("hunterKey").value = saved;
  $("hunterKey").addEventListener("change", () =>
    localStorage.setItem("amic_hunter_key", $("hunterKey").value.trim()));
  $("minConf").addEventListener("input", () => { $("confVal").textContent = parseFloat($("minConf").value).toFixed(1); });

  $("searchForm").addEventListener("submit", (e) => { e.preventDefault(); search(); });
  $("resetBtn").addEventListener("click", resetFilters);
  $("findBtn").addEventListener("click", findEmails);
  $("acceptBtn").addEventListener("click", () => applyAction("accept"));
  $("clearBtn").addEventListener("click", () => applyAction("clear"));
}

if (document.readyState !== "loading") init();
else document.addEventListener("DOMContentLoaded", init);
