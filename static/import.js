"use strict";
// Bulk-import wizard. The file is parsed in the browser (SheetJS); only mapped
// JSON rows are sent to the server, which dedupes, inserts, and embeds.

const $ = (id) => document.getElementById(id);

const FIELDS = [
  ["full_name", "Full name"], ["first_name", "First name"], ["last_name", "Last name"],
  ["title", "Title"], ["organization", "Organization"], ["email", "Email"],
  ["email_status", "Email status"], ["phone", "Phone"], ["linkedin", "LinkedIn / web"],
  ["city", "City"], ["state", "State"], ["tags", "Tags"],
  ["source_lists", "Source list"], ["notes", "Notes"],
];

// header alias -> field, for auto-mapping
const ALIASES = {
  full_name: ["full name", "fullname", "name", "contact", "contact name"],
  first_name: ["first", "first name", "fname", "given", "given name"],
  last_name: ["last", "last name", "lname", "surname", "family name"],
  title: ["title", "job title", "position", "role", "job"],
  organization: ["organization", "organisation", "org", "company", "employer", "account", "business"],
  email: ["email", "e-mail", "email address", "e-mail address", "mail"],
  email_status: ["email status", "status"],
  phone: ["phone", "telephone", "tel", "mobile", "cell", "business phone", "phone number"],
  linkedin: ["linkedin", "linkedin url", "web page", "website", "url"],
  city: ["city", "business city", "town"],
  state: ["state", "province", "region", "business state"],
  tags: ["tags", "tag", "category", "categories", "interests"],
  source_lists: ["source", "source list", "source lists", "list"],
  notes: ["notes", "note", "comments", "comment"],
};

let headers = [];   // source column headers
let records = [];   // array of objects keyed by source header
let mapping = {};   // source header -> target field ("" = skip)
let mappedRows = []; // [{field: value}] sent to the API

// ---------------------------------------------------------------- steps
function goStep(n) {
  for (let i = 1; i <= 4; i++) $("panel-" + i).hidden = i !== n;
  document.querySelectorAll(".step").forEach((el) => {
    const s = +el.dataset.step;
    el.classList.toggle("active", s === n);
    el.classList.toggle("done", s < n);
  });
  window.scrollTo({ top: 0, behavior: "smooth" });
}

// ---------------------------------------------------------------- file parse
function autoMap(h) {
  const key = String(h || "").trim().toLowerCase();
  for (const [field, aliases] of Object.entries(ALIASES)) {
    if (aliases.includes(key)) return field;
  }
  return "";
}

function handleFile(file) {
  $("fileName").textContent = file.name;
  const reader = new FileReader();
  reader.onload = (e) => {
    const wb = XLSX.read(e.target.result, { type: "array" });
    const ws = wb.Sheets[wb.SheetNames[0]];
    const rows = XLSX.utils.sheet_to_json(ws, { defval: "", raw: false });
    if (!rows.length) { alert("That file has no data rows."); return; }
    records = rows;
    headers = Object.keys(rows[0]);
    // prevent two source columns mapping to the same field by default
    const used = new Set();
    mapping = {};
    headers.forEach((h) => {
      let f = autoMap(h);
      if (f && used.has(f)) f = "";
      if (f) used.add(f);
      mapping[h] = f;
    });
    renderMapping();
    goStep(2);
  };
  reader.readAsArrayBuffer(file);
}

function renderMapping() {
  const sample = records[0] || {};
  $("mapGrid").innerHTML = headers.map((h) => {
    const opts = ['<option value="">— skip —</option>'].concat(
      FIELDS.map(([v, label]) =>
        `<option value="${v}" ${mapping[h] === v ? "selected" : ""}>${label}</option>`)
    ).join("");
    const ex = String(sample[h] ?? "").slice(0, 40);
    return `<div class="map-row">
      <div class="map-src"><strong>${esc(h)}</strong>
        <span class="muted sm">${esc(ex) || "—"}</span></div>
      <div class="map-arrow">→</div>
      <select class="map-sel" data-h="${esc(h)}">${opts}</select>
    </div>`;
  }).join("");
  $("mapGrid").querySelectorAll(".map-sel").forEach((sel) => {
    sel.addEventListener("change", () => { mapping[sel.dataset.h] = sel.value; });
  });
}

function esc(s) {
  return (s == null ? "" : String(s)).replace(/[&<>"]/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
}

function buildMappedRows() {
  const pairs = Object.entries(mapping).filter(([, f]) => f);
  return records.map((rec) => {
    const out = {};
    for (const [h, f] of pairs) {
      const v = String(rec[h] ?? "").trim();
      if (v) out[f] = out[f] ? out[f] + "; " + v : v;
    }
    return out;
  });
}

// ---------------------------------------------------------------- preview
async function toReview() {
  const fields = new Set(Object.values(mapping).filter(Boolean));
  if (!fields.has("full_name") && !(fields.has("first_name") && fields.has("last_name"))) {
    alert("Map a Full name column, or both First name and Last name.");
    return;
  }
  mappedRows = buildMappedRows();
  $("toReviewBtn").setAttribute("aria-busy", "true");
  try {
    const res = await fetch("/api/import/preview", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ rows: mappedRows }),
    });
    if (res.status === 401) { window.location = "/login"; return; }
    const data = await res.json();
    renderPreview(data);
    goStep(3);
  } catch (e) {
    alert("Preview failed: " + e);
  } finally {
    $("toReviewBtn").removeAttribute("aria-busy");
  }
}

function renderPreview(data) {
  $("statRow").innerHTML = `
    <div class="stat new"><strong>${data.new}</strong><span>new</span></div>
    <div class="stat dupe"><strong>${data.duplicates}</strong><span>likely duplicates</span></div>
    <div class="stat err"><strong>${data.errors}</strong><span>skipped (no name)</span></div>
    <div class="stat tot"><strong>${data.total}</strong><span>total rows</span></div>`;
  const rows = (data.rows || []).slice(0, 200);
  $("previewTable").innerHTML =
    `<thead><tr><th>Status</th><th>Name</th><th>Organization</th><th>Email</th></tr></thead><tbody>` +
    rows.map((r) => {
      const badge = r.status === "new"
        ? '<span class="pill new">new</span>'
        : r.status === "duplicate"
          ? `<span class="pill dupe">dup · ${esc(r.matched_on)}</span>`
          : '<span class="pill err">no name</span>';
      return `<tr><td>${badge}</td><td>${esc(r.full_name) || "—"}</td>
        <td>${esc(r.organization) || "—"}</td><td>${esc(r.email) || "—"}</td></tr>`;
    }).join("") + "</tbody>";
}

// ---------------------------------------------------------------- import + poll
async function runImport() {
  goStep(4);
  $("doneHead").textContent = "Importing…";
  const policy = document.querySelector('input[name="policy"]:checked').value;
  const source_label = $("sourceLabel").value.trim() || null;
  try {
    const res = await fetch("/api/import/commit", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ rows: mappedRows, policy, source_label }),
    });
    if (res.status === 401) { window.location = "/login"; return; }
    const { job, error } = await res.json();
    if (!job) throw new Error(error || "could not start import");
    pollJob(job);
  } catch (e) {
    $("progMsg").textContent = "Failed: " + e;
  }
}

async function pollJob(job) {
  const res = await fetch("/api/jobs/" + job);
  if (res.status === 401) { window.location = "/login"; return; }
  const j = await res.json();
  const pct = j.total ? Math.round((j.done / j.total) * 100) : (j.status === "done" ? 100 : 8);
  $("progBar").style.width = pct + "%";
  $("progMsg").textContent = j.message || "";
  if (j.status === "running") { setTimeout(() => pollJob(job), 600); return; }
  if (j.status === "error") {
    $("doneHead").textContent = "Import failed";
    $("progMsg").textContent = j.error || "Unknown error";
    return;
  }
  const r = j.result || {};
  $("progBar").style.width = "100%";
  $("doneHead").textContent = "Import complete ✓";
  $("progMsg").textContent = "";
  $("summary").hidden = false;
  $("summary").innerHTML = `
    <div class="stat new"><strong>${r.inserted || 0}</strong><span>added</span></div>
    <div class="stat dupe"><strong>${r.merged || 0}</strong><span>merged</span></div>
    <div class="stat err"><strong>${r.skipped || 0}</strong><span>skipped</span></div>
    <div class="stat tot"><strong>${r.embedded || 0}</strong><span>embedded for search</span></div>`;
  $("doneActions").hidden = false;
}

// ---------------------------------------------------------------- wiring
function init() {
  const drop = $("drop"), file = $("file");
  $("browseBtn").addEventListener("click", () => file.click());
  drop.addEventListener("click", (e) => { if (e.target === drop || e.target.closest(".drop-inner") && e.target.tagName !== "BUTTON") file.click(); });
  file.addEventListener("change", () => file.files[0] && handleFile(file.files[0]));
  ["dragover", "dragenter"].forEach((ev) =>
    drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.add("over"); }));
  ["dragleave", "drop"].forEach((ev) =>
    drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.remove("over"); }));
  drop.addEventListener("drop", (e) => e.dataTransfer.files[0] && handleFile(e.dataTransfer.files[0]));

  $("toReviewBtn").addEventListener("click", toReview);
  $("importBtn").addEventListener("click", runImport);
  $("anotherBtn").addEventListener("click", () => window.location.reload());
  document.querySelectorAll("[data-back]").forEach((b) =>
    b.addEventListener("click", () => goStep(+b.dataset.back)));
}

if (document.readyState !== "loading") init();
else document.addEventListener("DOMContentLoaded", init);
