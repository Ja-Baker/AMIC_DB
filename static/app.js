"use strict";

const $ = (id) => document.getElementById(id);
const tbody = document.querySelector("#resultsTable tbody");

function gatherParams() {
  const tags = $("tags").value.split(",").map((s) => s.trim()).filter(Boolean);
  return {
    q: $("q").value,
    tags: tags.length ? tags : null,
    state: $("state").value || null,
    email_status: $("email_status").value || null,
    source: $("source").value || null,
    semantic_weight: parseFloat($("semantic_weight").value),
    limit: parseInt($("limit").value, 10) || 50,
  };
}

function esc(s) {
  return (s == null ? "" : String(s)).replace(/[&<>"]/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
}

function render(rows) {
  tbody.innerHTML = "";
  for (const r of rows) {
    const loc = [r.city, r.state].filter(Boolean).join(", ");
    const tags = (r.tags || []).map((t) => `<span class="tag">${esc(t)}</span>`).join("");
    const email = r.email
      ? `<a class="email" href="mailto:${esc(r.email)}">${esc(r.email)}</a>`
      : `<span class="muted">—</span>`;
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td class="score">${r.score?.toFixed ? r.score.toFixed(3) : esc(r.score)}</td>
      <td><strong>${esc(r.full_name)}</strong><div class="muted">${esc(r.contact_id)}</div></td>
      <td>${esc(r.title) || "<span class='muted'>—</span>"}</td>
      <td>${esc(r.organization) || "<span class='muted'>—</span>"}</td>
      <td>${email}<div class="muted">${esc(r.email_status || "")}</div></td>
      <td>${esc(r.phone) || "<span class='muted'>—</span>"}</td>
      <td>${esc(loc) || "<span class='muted'>—</span>"}</td>
      <td><div class="tags">${tags}</div></td>`;
    tbody.appendChild(tr);
  }
  $("resultsTable").hidden = rows.length === 0;
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
  $("tagList").innerHTML = m.tags.map((t) => `<option value="${esc(t)}">`).join("");
}

$("searchForm").addEventListener("submit", (e) => { e.preventDefault(); search(); });
$("exportBtn").addEventListener("click", exportCsv);
$("semantic_weight").addEventListener("input", (e) => { $("swVal").textContent = e.target.value; });
loadMeta();
