"use strict";

const $ = (id) => document.getElementById(id);
let POC_CHOICES = [];
let table = null;
let currentListId = null;
const ts = {}; // Tom Select instances

// ---------------------------------------------------------------- helpers
function esc(s) {
  return (s == null ? "" : String(s)).replace(/[&<>"]/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
}
const dash = (v) => esc(v) || "<span class='muted'>—</span>";

function singleVal(name) {
  const v = ts[name] ? ts[name].getValue() : ($(name).value || "");
  return v || null;
}

function gatherParams() {
  return {
    q: $("q").value,
    tags: (ts.tags ? ts.tags.getValue() : []).length ? ts.tags.getValue() : null,
    state: singleVal("state"),
    email_status: singleVal("email_status"),
    source: singleVal("source"),
    poc: singleVal("poc"),
    include_dnc: $("include_dnc").checked,
    semantic_weight: parseFloat($("semantic_weight").value),
  };
}

// ---------------------------------------------------------------- formatters
function matchFmt(cell) {
  const mf = cell.getValue();
  if (!mf) return '<span class="match related" title="Found by meaning, not exact words">related</span>';
  if (mf === "similar") return '<span class="match similar" title="Close / typo match">similar</span>';
  const label = { name: "name", organization: "org", title: "title", tags: "tag", city: "city", notes: "notes" }[mf] || mf;
  return `<span class="match exact" title="Exact match in ${esc(mf)}">${esc(label)}</span>`;
}
function emailFmt(cell) {
  const e = cell.getValue();
  if (!e) return "<span class='muted'>—</span>";
  const st = cell.getRow().getData().email_status || "";
  return `<a class="email" href="mailto:${esc(e)}">${esc(e)}</a>` +
         (st ? `<div class="muted sm">${esc(st)}</div>` : "");
}
function locFmt(cell) {
  const d = cell.getRow().getData();
  return dash([d.city, d.state].filter(Boolean).join(", "));
}
function tagsFmt(cell) {
  const t = cell.getValue() || [];
  return t.length ? `<div class="tags">${t.map((x) => `<span class="tag">${esc(x)}</span>`).join("")}</div>` : "<span class='muted'>—</span>";
}
function sourceFmt(cell) {
  const s = cell.getValue() || [];
  return s.length ? `<span class="muted sm">${esc(s.join("; "))}</span>` : "<span class='muted'>—</span>";
}
function dncFmt(cell) {
  return cell.getValue() ? '<span class="dnc">do not contact</span>' : "";
}

// ---------------------------------------------------------------- POC save
async function savePoc(cell) {
  const id = cell.getRow().getData().contact_id;
  const val = cell.getValue() || null;
  try {
    const res = await fetch("/api/poc", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ contact_id: id, poc: val }),
    });
    if (res.status === 401) { window.location = "/login"; return; }
    if (!res.ok) throw new Error("save failed");
    flash(`POC saved for ${id}`);
  } catch (e) {
    cell.setValue(cell.getOldValue(), true); // revert without re-triggering edit
    flash("Could not save POC", true);
  }
}

// ---------------------------------------------------------------- table
function buildTable() {
  table = new Tabulator("#grid", {
    index: "contact_id",
    layout: "fitDataFill",
    height: "calc(100dvh - 232px)",
    placeholder: "<div class='empty'><strong>No results yet</strong>" +
      "<span>Type a search or pick filters on the left, then hit Search. " +
      "Leave the box empty to browse by filters alone.</span></div>",
    selectableRows: true,
    columnDefaults: { headerHozAlign: "left", resizable: true },
    columns: [
      { formatter: "rowSelection", titleFormatter: "rowSelection", hozAlign: "center",
        headerSort: false, width: 42, frozen: true, download: false },
      { title: "Match", field: "match_field", width: 92, formatter: matchFmt, hozAlign: "center" },
      { title: "Last name", field: "last_name", minWidth: 130, frozen: true,
        formatter: (c) => `<strong>${dash(c.getValue())}</strong><div class="muted sm">${esc(c.getRow().getData().contact_id)}</div>` },
      { title: "First name", field: "first_name", minWidth: 110, formatter: (c) => dash(c.getValue()) },
      { title: "Organization", field: "organization", minWidth: 200, formatter: (c) => dash(c.getValue()) },
      { title: "Title", field: "title", minWidth: 170, formatter: (c) => dash(c.getValue()) },
      { title: "Email", field: "email", minWidth: 200, formatter: emailFmt,
        accessorDownload: (v) => v || "" },
      { title: "Phone", field: "phone", minWidth: 120, formatter: (c) => dash(c.getValue()) },
      { title: "Location", field: "city", minWidth: 140, formatter: locFmt, headerSort: false,
        accessorDownload: (v, d) => [d.city, d.state].filter(Boolean).join(", ") },
      { title: "Tags", field: "tags", minWidth: 180, formatter: tagsFmt, headerSort: false,
        accessorDownload: (v) => (v || []).join("; ") },
      { title: "Source", field: "source_lists", minWidth: 140, formatter: sourceFmt, headerSort: false,
        accessorDownload: (v) => (v || []).join("; ") },
      { title: "POC", field: "poc", width: 86, hozAlign: "center", editor: "list",
        editorParams: { values: { "": "—", TH: "TH", KM: "KM", BW: "BW", DS: "DS" } },
        cellEdited: savePoc },
      { title: "DNC", field: "do_not_contact", width: 90, hozAlign: "center", formatter: dncFmt,
        accessorDownload: (v) => (v ? "yes" : "") },
    ],
  });
  table.on("rowSelectionChanged", (data) => updateSelectionUI(data.length));
}

function updateSelectionUI(n) {
  $("selCount").hidden = n === 0;
  $("findEmailBtn").hidden = n === 0;
  $("selCount").textContent = `${n} selected`;
  // list-context buttons depend on both selection and whether a list is open
  if (currentListId != null) {
    $("addToListBtn").hidden = n === 0;
    $("removeFromListBtn").hidden = n === 0;
  }
}
function selectedIds() {
  return (table ? table.getSelectedData() : []).map((d) => d.contact_id);
}

// ---------------------------------------------------------------- search
async function search() {
  if (currentListId != null) exitListContext();
  const btn = $("searchBtn");
  btn.setAttribute("aria-busy", "true");
  $("status").textContent = "Searching…";
  try {
    const res = await fetch("/api/search", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify(gatherParams()),
    });
    if (res.status === 401) { window.location = "/login"; return; }
    const data = await res.json();
    await table.setData(data.results || []);
    $("status").textContent = data.count
      ? `${data.count} contact${data.count === 1 ? "" : "s"} found`
      : "No contacts matched.";
  } catch (e) {
    $("status").textContent = "Search failed: " + e;
  } finally {
    btn.removeAttribute("aria-busy");
  }
}

function resetFilters() {
  $("q").value = "";
  ["state", "email_status", "source", "poc"].forEach((n) => ts[n] && ts[n].clear());
  ts.tags && ts.tags.clear();
  $("include_dnc").checked = false;
  $("semantic_weight").value = 0.7;
  table.clearData();
  $("status").textContent = "Enter a search to begin.";
}

// ---------------------------------------------------------------- export menu
// Scope = selected rows if any, else everything currently in the grid (WYSIWYG,
// and works for saved lists too). The server fetches those contact_ids exactly.
function exportScopeIds() {
  const sel = table ? table.getSelectedData() : [];
  const rows = sel.length ? sel : (table ? table.getData() : []);
  return rows.map((r) => r.contact_id);
}
function exportBody() {
  return {
    contact_ids: exportScopeIds(),
    require_email: $("optRequireEmail").checked,
    dedupe_email: $("optDedupeEmail").checked,
  };
}
async function postDownload(url, filename) {
  const body = exportBody();
  if (!body.contact_ids.length) { flash("Nothing to export", true); return; }
  const res = await fetch(url, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (res.status === 401) { window.location = "/login"; return; }
  if (!res.ok) { flash("Export failed", true); return; }
  const blob = await res.blob();
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 4000);
}
async function exportBcc() {
  const body = exportBody();
  if (!body.contact_ids.length) { flash("Nothing to export", true); return; }
  const res = await fetch("/api/export/bcc", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (res.status === 401) { window.location = "/login"; return; }
  const d = await res.json();
  if (!d.count) { flash("No emails to copy", true); return; }
  try { await navigator.clipboard.writeText(d.emails); flash(`Copied ${d.count} addresses`); }
  catch (e) { window.prompt(`${d.count} addresses — copy below:`, d.emails); }
}
function doExport(fmt) {
  toggleExportPanel(false);
  if (fmt === "xlsx") postDownload("/api/export.xlsx", "amic_invitees.xlsx");
  else if (fmt === "outlook") postDownload("/api/export/outlook.csv", "amic_outlook_contacts.csv");
  else if (fmt === "csv") postDownload("/api/export.csv", "amic_contacts.csv");
  else if (fmt === "bcc") exportBcc();
}
function toggleExportPanel(show) {
  const p = $("exportPanel");
  const open = show != null ? show : p.hidden;
  p.hidden = !open;
  if (open) {
    const n = (table ? table.getSelectedData() : []).length;
    const tot = (table ? table.getData() : []).length;
    $("exportScope").textContent = n ? `· ${n} selected` : `· all ${tot}`;
  }
}

// ---------------------------------------------------------------- find emails
async function findEmails() {
  const ids = selectedIds();
  if (!ids.length) { flash("Select contacts first", true); return; }
  if (!confirm(`Search for missing emails on ${ids.length} selected contact(s)?\n` +
               `Only contacts without an email are looked up. This can take a moment.`)) return;
  $("findEmailBtn").setAttribute("aria-busy", "true");
  $("status").textContent = "Finding emails…";
  try {
    const { job } = await api("/api/email/find", { contact_ids: ids });
    pollEmailJob(job);
  } catch (e) {
    flash(e.message, true);
    $("findEmailBtn").removeAttribute("aria-busy");
  }
}
async function pollEmailJob(job) {
  const res = await fetch("/api/jobs/" + job);
  if (res.status === 401) { window.location = "/login"; return; }
  const j = await res.json();
  if (j.message) $("status").textContent = j.message;
  if (j.status === "running") { setTimeout(() => pollEmailJob(job), 700); return; }
  $("findEmailBtn").removeAttribute("aria-busy");
  if (j.status === "error") { flash(j.error || "Email search failed", true); return; }
  const r = j.result || {};
  flash(`Found ${r.found} of ${r.checked} email${r.checked === 1 ? "" : "s"}`);
  // Refresh from the DB so the new (status: check) emails show in the grid.
  if (currentListId != null) openList(currentListId); else search();
}

// ---------------------------------------------------------------- meta / init
function addOptions(sel, values) {
  for (const v of values) sel.add(new Option(v, v));
}
async function loadMeta() {
  const res = await fetch("/api/meta");
  if (!res.ok) return;
  const m = await res.json();
  POC_CHOICES = m.poc_choices || [];
  addOptions($("state"), m.states);
  addOptions($("email_status"), m.email_statuses);
  addOptions($("source"), m.sources);
  addOptions($("poc"), POC_CHOICES);
  for (const t of m.tags) $("tags").add(new Option(t, t));

  const single = { create: false, allowEmptyOption: true, controlInput: null };
  ts.state = new TomSelect("#state", single);
  ts.email_status = new TomSelect("#email_status", single);
  ts.source = new TomSelect("#source", single);
  ts.poc = new TomSelect("#poc", single);
  ts.tags = new TomSelect("#tags", { create: false, plugins: ["remove_button"], maxOptions: 500 });
}

let flashTimer = null;
function flash(msg, bad) {
  let el = $("toast");
  if (!el) { el = document.createElement("div"); el.id = "toast"; document.body.appendChild(el); }
  el.textContent = msg;
  el.className = "toast show" + (bad ? " bad" : "");
  clearTimeout(flashTimer);
  flashTimer = setTimeout(() => { el.className = "toast"; }, 1800);
}

// ---------------------------------------------------------------- saved lists
async function api(url, body) {
  const opt = body ? { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) } : {};
  const res = await fetch(url, opt);
  if (res.status === 401) { window.location = "/login"; throw new Error("auth"); }
  if (!res.ok) { const e = await res.json().catch(() => ({})); throw new Error(e.error || "request failed"); }
  return res.json();
}

async function refreshLists() {
  const ul = $("listsUl");
  try {
    const { lists } = await api("/api/lists");
    ul.innerHTML = lists.length
      ? lists.map((l) =>
          `<li data-id="${l.id}">
             <button class="list-open" title="Open list">${esc(l.name)} <span class="muted">(${l.count})</span></button>
             <button class="list-add" title="Add selected to this list">＋</button>
           </li>`).join("")
      : '<li class="muted sm pad">No saved lists yet.</li>';
  } catch (e) { ul.innerHTML = `<li class="muted sm pad">${esc(e.message)}</li>`; }
}

function toggleListsPanel(show) {
  const p = $("listsPanel");
  const open = show != null ? show : p.hidden;
  p.hidden = !open;
  if (open) refreshLists();
}

async function openList(id) {
  try {
    const data = await api(`/api/lists/${id}`);
    currentListId = id;
    table.hideColumn("match_field");
    await table.setData(data.members || []);
    $("listName").textContent = data.name;
    $("listMembCount").textContent = `(${data.count})`;
    $("listBanner").hidden = false;
    $("status").textContent = `Saved list — ${data.count} contact${data.count === 1 ? "" : "s"}`;
    updateSelectionUI(0);
    toggleListsPanel(false);
  } catch (e) { flash(e.message, true); }
}

function exitListContext() {
  currentListId = null;
  $("listBanner").hidden = true;
  $("addToListBtn").hidden = true;
  $("removeFromListBtn").hidden = true;
  table.showColumn("match_field");
}
function backToSearch() {
  exitListContext();
  table.clearData();
  $("status").textContent = "Enter a search to begin.";
}

async function newList() {
  const ids = selectedIds();
  const name = (prompt(`Name this list${ids.length ? ` (${ids.length} selected)` : ""}:`) || "").trim();
  if (!name) return;
  try {
    const r = await api("/api/lists", { name, contact_ids: ids });
    flash(`Created “${name}”${ids.length ? ` with ${r.added}` : ""}`);
    refreshLists();
  } catch (e) { flash(e.message, true); }
}

async function addSelectedToList(id) {
  const ids = selectedIds();
  if (!ids.length) { flash("Select contacts first", true); return; }
  try {
    const r = await api(`/api/lists/${id}/add`, { contact_ids: ids });
    flash(`Added ${r.added} to list`);
    refreshLists();
    if (currentListId === id) openList(id);
  } catch (e) { flash(e.message, true); }
}

async function removeSelectedFromList() {
  const ids = selectedIds();
  if (!ids.length || currentListId == null) return;
  try {
    const r = await api(`/api/lists/${currentListId}/remove`, { contact_ids: ids });
    flash(`Removed ${r.removed}`);
    openList(currentListId);
  } catch (e) { flash(e.message, true); }
}

async function renameList() {
  if (currentListId == null) return;
  const name = (prompt("Rename list:", $("listName").textContent) || "").trim();
  if (!name) return;
  try {
    await api(`/api/lists/${currentListId}/rename`, { name });
    $("listName").textContent = name;
    flash("Renamed");
    refreshLists();
  } catch (e) { flash(e.message, true); }
}

async function deleteList() {
  if (currentListId == null) return;
  if (!confirm(`Delete list “${$("listName").textContent}”? This can’t be undone.`)) return;
  try {
    await api(`/api/lists/${currentListId}/delete`, {});
    flash("List deleted");
    backToSearch();
    refreshLists();
  } catch (e) { flash(e.message, true); }
}

function init() {
  buildTable();
  loadMeta();
  $("searchForm").addEventListener("submit", (e) => { e.preventDefault(); search(); });
  $("resetBtn").addEventListener("click", resetFilters);
  $("findEmailBtn").addEventListener("click", findEmails);

  // export menu
  $("exportBtn").addEventListener("click", (e) => { e.stopPropagation(); toggleExportPanel(); });
  $("exportPanel").querySelectorAll(".export-fmt").forEach((b) =>
    b.addEventListener("click", () => doExport(b.dataset.fmt)));

  // saved lists
  $("listsBtn").addEventListener("click", (e) => { e.stopPropagation(); toggleListsPanel(); });
  $("listsUl").addEventListener("click", (e) => {
    const li = e.target.closest("li[data-id]"); if (!li) return;
    const id = parseInt(li.dataset.id, 10);
    if (e.target.classList.contains("list-add")) addSelectedToList(id);
    else openList(id);
  });
  $("newListBtn").addEventListener("click", newList);
  $("addToListBtn").addEventListener("click", () => addSelectedToList(currentListId));
  $("removeFromListBtn").addEventListener("click", removeSelectedFromList);
  $("renameListBtn").addEventListener("click", renameList);
  $("deleteListBtn").addEventListener("click", deleteList);
  $("backBtn").addEventListener("click", backToSearch);
  document.addEventListener("click", (e) => {
    if (e.target.closest(".lists-menu")) return;  // click inside either menu
    if (!$("listsPanel").hidden) toggleListsPanel(false);
    if (!$("exportPanel").hidden) toggleExportPanel(false);
  });
}

if (document.readyState !== "loading") init();
else document.addEventListener("DOMContentLoaded", init);
