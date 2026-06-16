"use strict";

const $ = (id) => document.getElementById(id);
const tbody = document.querySelector("#resultsTable tbody");
let POC_CHOICES = [];

function gatherParams() {
  const tags = $("tags").value.split(",").map((s) => s.trim()).filter(Boolean);
  return {
    q: $("q").value,
    tags: tags.length ? tags : null,
    state: $("state").value || null,
    email_status: $("email_status").value || null,
    source: $("source").value || null,
    poc: $("poc").value || null,
    include_dnc: $("include_dnc").checked,
    semantic_weight: parseFloat($("semantic_weight").value),
    limit: parseInt($("limit").value, 10) || 50,
  };
}

function esc(s) {
  return (s == null ? "" : String(s)).replace(/[&<>"]/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
}

function dash(v) {
  return esc(v) || "<span class='muted'>—</span>";
}

function matchBadge(r) {
  const mf = r.match_field;
  if (!mf) return `<span class="match related" title="Found by meaning, not exact words">related</span>`;
  if (mf === "similar")
    return `<span class="match similar" title="Close / typo match on name or organization">similar</span>`;
  const label = { name: "name", organization: "org", title: "title",
                  tags: "tag", city: "city", notes: "notes" }[mf] || mf;
  return `<span class="match exact" title="Exact match in ${esc(mf)}">${esc(label)}</span>`;
}

function pocSelect(r) {
  const opts = ['<option value="">—</option>']
    .concat(POC_CHOICES.map((p) =>
      `<option value="${esc(p)}"${p === r.poc ? " selected" : ""}>${esc(p)}</option>`))
    .join("");
  return `<select class="poc-select" data-id="${esc(r.contact_id)}">${opts}</select>`;
}

function render(rows) {
  tbody.innerHTML = "";
  for (const r of rows) {
    const loc = [r.city, r.state].filter(Boolean).join(", ");
    const tags = (r.tags || []).map((t) => `<span class="tag">${esc(t)}</span>`).join("");
    const source = (r.source_lists || []).join("; ");
    const email = r.email
      ? `<a class="email" href="mailto:${esc(r.email)}">${esc(r.email)}</a>`
      : `<span class="muted">—</span>`;
    const dnc = r.do_not_contact ? `<span class="dnc">do not contact</span>` : "";
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${matchBadge(r)}</td>
      <td><strong>${dash(r.last_name)}</strong><div class="muted">${esc(r.contact_id)}</div></td>
      <td>${dash(r.first_name)}</td>
      <td>${dash(r.organization)}</td>
      <td>${dash(r.title)}</td>
      <td>${email}<div class="muted">${esc(r.email_status || "")}</div></td>
      <td>${dash(r.phone)}</td>
      <td>${dash(loc)}</td>
      <td><div class="tags">${tags}</div></td>
      <td class="muted">${esc(source)}</td>
      <td>${pocSelect(r)}</td>
      <td>${dnc}</td>`;
    tbody.appendChild(tr);
  }
  $("resultsTable").hidden = rows.length === 0;
}

async function savePoc(sel) {
  const prev = sel.dataset.prev || "";
  sel.disabled = true;
  try {
    const res = await fetch("/api/poc", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ contact_id: sel.dataset.id, poc: sel.value || null }),
    });
    if (res.status === 401) { window.location = "/login"; return; }
    if (!res.ok) throw new Error("save failed");
    sel.dataset.prev = sel.value;
    sel.classList.add("saved");
    setTimeout(() => sel.classList.remove("saved"), 900);
  } catch (e) {
    sel.value = prev;            // revert on failure
    $("status").textContent = "Could not save POC: " + e;
  } finally {
    sel.disabled = false;
  }
}

async function search() {
  $("status").textContent = "Searching…";
  try {
    const res = await fetch("/api/search", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(gatherParams()),
    });
    if (res.status === 401) { window.location = "/login"; return; }
    const data = await res.json();
    render(data.results || []);
    $("status").textContent = data.count
      ? `${data.count} contact${data.count === 1 ? "" : "s"} found`
      : "No contacts matched.";
  } catch (e) {
    $("status").textContent = "Search failed: " + e;
  }
}

async function exportCsv() {
  $("status").textContent = "Building CSV…";
  const res = await fetch("/api/export.csv", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(gatherParams()),
  });
  if (res.status === 401) { window.location = "/login"; return; }
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "amic_contacts.csv";
  a.click();
  URL.revokeObjectURL(url);
  $("status").textContent = "CSV downloaded.";
}

async function loadMeta() {
  const res = await fetch("/api/meta");
  if (!res.ok) return;
  const m = await res.json();
  for (const s of m.states) $("state").add(new Option(s, s));
  for (const s of m.email_statuses) $("email_status").add(new Option(s, s));
  for (const s of m.sources) $("source").add(new Option(s, s));
  POC_CHOICES = m.poc_choices || [];
  for (const p of POC_CHOICES) $("poc").add(new Option(p, p));
  $("tagList").innerHTML = m.tags.map((t) => `<option value="${esc(t)}">`).join("");
}

$("searchForm").addEventListener("submit", (e) => { e.preventDefault(); search(); });
$("exportBtn").addEventListener("click", exportCsv);
$("semantic_weight").addEventListener("input", (e) => { $("swVal").textContent = e.target.value; });
// inline POC edits (event delegation; remember prior value for revert-on-error)
tbody.addEventListener("focusin", (e) => {
  if (e.target.classList.contains("poc-select")) e.target.dataset.prev = e.target.value;
});
tbody.addEventListener("change", (e) => {
  if (e.target.classList.contains("poc-select")) savePoc(e.target);
});
loadMeta();
