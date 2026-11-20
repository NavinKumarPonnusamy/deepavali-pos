// js/v2/admin/summary.js — "Closing & profit" tab.
// Close a day (cash check + hours → salary expenses) and see the whole event's profit.
import { db } from "../../firebase.js";
import { doc, setDoc, deleteDoc } from "https://www.gstatic.com/firebasejs/13.0.0/firebase-firestore.js";
import { rm, todayKey, esc, round2 } from "../../utils.js";
import { currentCode } from "../../auth-gate.js";
import { state, onChange } from "./data.js";
import { allDays, daySales, cashCheck, eventSummary } from "./calc.js";
import { eventReport } from "./report.js";

const $ = (id) => document.getElementById(id);
let day = null;
let rows = [];          // staff rows being edited [{ name, hours }]
let formDay = null;     // which day the form was filled from
let typing = false;

const nice = (d) => new Date(d + "T00:00").toLocaleDateString("en-MY", { weekday: "short", day: "numeric", month: "short" });
const salaryId = (d, name) => `salary_${d}_${name.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-")}`;

export function init() {
  onChange((w) => {
    if (["orders", "days", "expenses", "settings"].includes(w)) { renderEvent(); renderClose(); }
    if (w === "settings") fillSettings();
  });
  $("closeDay").addEventListener("change", () => { day = $("closeDay").value; formDay = null; renderClose(); });
  ["cFloat", "cCounted"].forEach((id) => $(id).addEventListener("input", () => { typing = true; renderCash(); }));
  $("addStaffBtn").addEventListener("click", () => { rows.push({ name: "", hours: "" }); renderStaff(); });
  $("staffRows").addEventListener("input", (e) => {
    const r = e.target.closest("[data-r]"); if (!r) return;
    rows[Number(r.dataset.r)][e.target.dataset.f] = e.target.value; typing = true;
    const pay = r.querySelector(".pay"); const h = Number(rows[Number(r.dataset.r)].hours) || 0;
    pay.textContent = rm(h * (Number(state.settings.hourlyRate) || 0));
  });
  $("staffRows").addEventListener("click", (e) => {
    const b = e.target.closest("[data-rm]"); if (!b) return;
    rows.splice(Number(b.dataset.rm), 1); renderStaff();
  });
  $("saveCloseBtn").addEventListener("click", saveClosing);
  $("settingsForm").addEventListener("submit", saveSettings);
  $("dlEvent").addEventListener("click", () => eventReport());
}

// ---------- Whole event ----------
function renderEvent() {
  const ev = eventSummary(state, todayKey());
  const stat = (l, v, cls = "") => `<div class="stat"><span>${l}</span><b class="${cls}">${v}</b></div>`;
  $("eventStats").innerHTML = [
    stat("Sales", rm(ev.sales)),
    stat("Expenses", rm(ev.expenses)),
    stat("Staff share", rm(ev.pool)),
    stat("Profit", rm(ev.profit), ev.profit < 0 ? "profit-neg" : "profit-pos"),
  ].join("");
  $("profitBody").innerHTML = `
    <tr><td>Sales</td><td class="num">${rm(ev.sales)}</td></tr>
    ${Object.entries(ev.byCat).sort((a, b) => b[1] - a[1]).map(([c, v]) => `<tr><td>− ${esc(c)}</td><td class="num">${rm(v)}</td></tr>`).join("")}
    <tr><td>− Staff share (${state.settings.sharePct}%)</td><td class="num">${rm(ev.pool)}</td></tr>
    <tr class="total"><td><b>Profit</b></td><td class="num"><b class="${ev.profit < 0 ? "profit-neg" : "profit-pos"}">${rm(ev.profit)}</b></td></tr>`;
  $("shareNote").textContent = `${state.settings.sharePct}% of all sales = ${rm(ev.pool)}, split equally between everyone who logged hours.`;
  $("shareBody").innerHTML = ev.staff.length
    ? ev.staff.map((n) => `<tr><td>${esc(n)}</td><td class="num">${rm(ev.each)}</td></tr>`).join("")
    : `<tr><td class="muted">No hours logged yet. Close a day to add staff.</td></tr>`;
  $("daysBody").innerHTML = ev.perDay.map((d) => `
    <tr><td>${nice(d.day)}</td><td class="num">${d.orders}</td><td class="num">${rm(d.sales)}</td>
      <td class="num">${rm(d.cash)}</td><td class="num">${rm(d.tng)}</td>
      <td class="num">${rm(d.expenses)}</td><td>${d.closed ? "✓" : `<span class="muted">not yet</span>`}</td></tr>`).join("")
    || `<tr><td colspan="7" class="muted">No sales yet.</td></tr>`;
}

// ---------- Close a day ----------
function renderClose() {
  const today = todayKey();
  const days = allDays(state, today);
  if (!day || !days.includes(day)) day = today;
  $("closeDay").innerHTML = days.map((d) => `<option value="${d}" ${d === day ? "selected" : ""}>${nice(d)}${d === today ? " (today)" : ""}</option>`).join("");
  const c = state.days[day];
  if (formDay !== day || !typing) {
    formDay = day; typing = false;
    $("cFloat").value = c?.float ?? state.settings.defaultFloat ?? "";
    $("cCounted").value = c?.countedCash ?? "";
    $("cNote").value = c?.note ?? "";
    rows = (c?.staff || []).map((p) => ({ name: p.name, hours: p.hours }));
    if (!rows.length) rows = (state.settings.staff || []).map((n) => ({ name: n, hours: "" }));
    if (!rows.length) rows = [{ name: "", hours: "" }];
    renderStaff();
  }
  $("closeState").textContent = c?.closedAt ? `Saved by ${c.closedBy || "?"}. Saving again updates it.` : c ? "Closed on the old screen. Saving here moves its salary into Expenses." : "Not closed yet.";
  renderCash();
}
function renderStaff() {
  const rate = Number(state.settings.hourlyRate) || 0;
  $("staffRows").innerHTML = rows.map((r, i) => `
    <div class="staff-row" data-r="${i}">
      <input data-f="name" value="${esc(r.name)}" placeholder="Name" aria-label="Name" list="staffNames">
      <input data-f="hours" type="number" min="0" step="0.5" value="${esc(r.hours)}" placeholder="Hours" aria-label="Hours">
      <span class="pay num">${rm((Number(r.hours) || 0) * rate)}</span>
      <button class="btn small ghost" type="button" data-rm="${i}" aria-label="Remove">✕</button>
    </div>`).join("") +
    `<datalist id="staffNames">${(state.settings.staff || []).map((n) => `<option value="${esc(n)}">`).join("")}</datalist>`;
}
function renderCash() {
  const ds = daySales(state, day);
  const chk = cashCheck(ds, { float: $("cFloat").value, countedCash: $("cCounted").value === "" ? null : $("cCounted").value });
  $("cashCheck").innerHTML = `Cash sales ${rm(ds.cash)} + float ${rm(Number($("cFloat").value) || 0)} = expected <b>${rm(round2((Number($("cFloat").value) || 0) + ds.cash))}</b>` +
    (chk ? ` · counted ${rm(chk.counted)} · <b class="${chk.diff < 0 ? "profit-neg" : "profit-pos"}">${chk.diff === 0 ? "matches" : (chk.diff < 0 ? "short " : "over ") + rm(Math.abs(chk.diff))}</b>` : "") +
    ` · TNG ${rm(ds.tng)}`;
}

async function saveClosing() {
  const rate = Number(state.settings.hourlyRate) || 0;
  const staff = rows.filter((r) => r.name.trim() && Number(r.hours) > 0).map((r) => ({ name: r.name.trim(), hours: Number(r.hours) }));
  const prev = state.days[day] || {};
  const closing = {
    ...prev,
    float: Number($("cFloat").value) || 0,
    countedCash: $("cCounted").value === "" ? null : Number($("cCounted").value),
    staff, note: $("cNote").value.trim(),
    closedAt: Date.now(), closedBy: currentCode(),
  };
  $("saveCloseBtn").disabled = true;
  try {
    await setDoc(doc(db, "days", day), closing);
    // salary → expenses (one per person per day; saving again replaces them)
    const keep = new Set();
    for (const p of staff) {
      const id = salaryId(day, p.name); keep.add(id);
      await setDoc(doc(db, "expenses", id), {
        date: day, what: `Salary: ${p.name}, ${p.hours} hrs × ${rm(rate)}`, amount: round2(p.hours * rate),
        category: "Salary", note: "", source: "salary", staff: p.name, hours: p.hours,
        createdAt: Date.now(), by: currentCode(),
      });
    }
    for (const e of state.expenses.filter((x) => x.source === "salary" && x.date === day && !keep.has(x.id))) {
      await deleteDoc(doc(db, "expenses", e.id));
    }
    typing = false;
    $("closeMsg").textContent = `Closing saved for ${nice(day)}. Salary added to Expenses.`;
  } catch (err) {
    $("closeMsg").textContent = "Couldn't save: " + (err.code || err.message);
  }
  $("saveCloseBtn").disabled = false;
}

// ---------- Settings ----------
function fillSettings() {
  if ($("settingsForm").contains(document.activeElement)) return;
  const s = state.settings;
  $("sRate").value = s.hourlyRate; $("sShare").value = s.sharePct; $("sFloat").value = s.defaultFloat;
  $("sStaff").value = (s.staff || []).join("\n");
}
async function saveSettings(e) {
  e.preventDefault();
  const next = {
    ...state.settings,
    hourlyRate: Number($("sRate").value) || 0, sharePct: Number($("sShare").value) || 0,
    defaultFloat: Number($("sFloat").value) || 0,
    staff: $("sStaff").value.split("\n").map((s) => s.trim()).filter(Boolean),
  };
  try { await setDoc(doc(db, "settings", "main"), next); $("settingsMsg").textContent = "Settings saved."; }
  catch (err) { $("settingsMsg").textContent = "Couldn't save: " + (err.code || err.message); }
}
