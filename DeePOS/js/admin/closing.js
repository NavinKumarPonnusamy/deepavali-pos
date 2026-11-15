// js/admin/closing.js
// Closing tab: settings, end-of-day stock count, cash count, staff hours, day summary, report.

import { db } from "../firebase.js";
import { doc, setDoc, writeBatch }
  from "https://www.gstatic.com/firebasejs/13.0.0/firebase-firestore.js";
import { currentCode } from "../auth-gate.js";
import { rm, round2, todayKey, esc } from "../utils.js";
import { fmtQty } from "../stock-math.js";
import { state, onChange } from "./data.js";
import { allDays, daySales, salary, cashCheck, profit, boothFeeFor } from "./calc.js";
import { downloadDay } from "./report.js";
import { dayLabel } from "./sales.js";

const $ = (id) => document.getElementById(id);
const sortedInv = () => Object.entries(state.inv).sort((a, b) => a[1].name.localeCompare(b[1].name));
let loadedDay = null;      // which day's saved closing is currently in the form

export function init() {
  onChange((what) => {
    if (what === "settings") { renderSettings(); renderStaff(); }
    if (["orders", "days", "settings"].includes(what)) { renderDaySelect(); }
    if (what === "inv") renderCount();
    if (["counts", "inv", "orders", "purchases"].includes(what)) renderGap();
    if (["orders", "days", "settings", "counts"].includes(what)) renderSummary();
    if (what === "days") updateCloseState();
  });
  $("closeDay").addEventListener("change", () => { loadedDay = null; fillForm(); renderCount(); renderGap(); renderSummary(); });
  ["cFloat", "cCounted", "cBoothFee"].forEach((id) => $(id).addEventListener("input", renderSummary));
  $("staffHours").addEventListener("input", renderSummary);
}

const selDay = () => $("closeDay").value || todayKey();

// ---------- Settings ----------
function renderSettings() {
  const s = state.settings;
  // don't overwrite while someone is typing in the settings box
  if ($("settingsForm").contains(document.activeElement)) return;
  $("sRate").value = s.hourlyRate;
  $("sShare").value = s.sharePct;
  $("sSplit").value = s.shareSplit;
  $("sBoothFee").value = s.boothFee;
  $("sEventDay").value = s.eventDay || "";
  $("sEventFee").value = s.eventBoothFee;
  $("sFloat").value = s.defaultFloat;
  $("sStaff").value = (s.staff || []).join("\n");
}

$("settingsForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const staff = $("sStaff").value.split("\n").map((n) => n.trim()).filter(Boolean);
  const data = {
    hourlyRate: Number($("sRate").value) || 0,
    sharePct: Number($("sShare").value) || 0,
    shareSplit: $("sSplit").value,
    boothFee: Number($("sBoothFee").value) || 0,
    eventDay: $("sEventDay").value,
    eventBoothFee: Number($("sEventFee").value) || 0,
    defaultFloat: Number($("sFloat").value) || 0,
    staff,
  };
  try {
    await setDoc(doc(db, "settings", "main"), data);
    $("settingsMsg").textContent = "Settings saved.";
    loadedDay = null; fillForm(); renderSummary();
  } catch (err) { $("settingsMsg").textContent = "Save failed: " + err.code; }
});

// ---------- Which day ----------
function renderDaySelect() {
  const days = allDays(state, todayKey());
  const keep = $("closeDay").value;
  $("closeDay").innerHTML = days.map((d) =>
    `<option value="${d}">${dayLabel(d)}${d === todayKey() ? " (today)" : ""}${state.days[d] ? " · closed" : ""}</option>`).join("");
  $("closeDay").value = days.includes(keep) ? keep : days[0];
  if (loadedDay !== selDay()) fillForm();
}

// Put the saved closing (or defaults) into the form
function fillForm() {
  const day = selDay();
  const c = state.days[day];
  $("cFloat").value = c?.float ?? state.settings.defaultFloat;
  $("cCounted").value = c?.countedCash ?? "";
  $("cBoothFee").value = c?.boothFee ?? boothFeeFor(day, state.settings);
  $("cNote").value = c?.note ?? "";
  renderStaff(true);
  updateCloseState();
  $("countBox").hidden = day !== todayKey();   // the stock count only works for today
  $("countPast").hidden = day === todayKey();
  loadedDay = day;
}

// One hours box per staff name (from Settings, plus anyone in the saved closing).
// fromSaved = true when switching day: take hours from the saved closing.
// Otherwise keep whatever has been typed, so a settings change never wipes it.
function renderStaff(fromSaved = false) {
  const c = state.days[selDay()];
  const typed = {};
  if (!fromSaved) document.querySelectorAll("[data-staff]").forEach((i) => { typed[i.dataset.staff] = i.value; });
  const names = [...new Set([...(state.settings.staff || []), ...((c?.staff || []).map((p) => p.name))])];
  $("staffHours").innerHTML = names.length ? names.map((n) => {
    const h = typed[n] ?? c?.staff?.find((p) => p.name === n)?.hours ?? "";
    return `<label class="field hours-field">${esc(n)}
      <input type="number" min="0" step="0.25" data-staff="${esc(n)}" value="${h}" placeholder="hours"></label>`;
  }).join("") : `<p class="muted">Add staff names in Settings (bottom of this tab) first.</p>`;
}

function updateCloseState() {
  const c = state.days[selDay()];
  $("closeState").textContent = c ? `Closed by ${c.closedBy}. Saving again updates it.` : "Not closed yet.";
}

function formClosing() {
  return {
    float: Number($("cFloat").value) || 0,
    countedCash: $("cCounted").value === "" ? null : Number($("cCounted").value),
    boothFee: Number($("cBoothFee").value) || 0,
    staff: [...document.querySelectorAll("[data-staff]")]
      .map((i) => ({ name: i.dataset.staff, hours: Number(i.value) || 0 }))
      .filter((p) => p.hours > 0),
    note: $("cNote").value.trim(),
  };
}

// ---------- Closing stock count (today only) ----------
function renderCount() {
  const typed = {};
  document.querySelectorAll("[data-close-id]").forEach((i) => { typed[i.dataset.closeId] = i.value; });
  $("closeCountBody").innerHTML = sortedInv().map(([id, it]) => `
    <tr>
      <td>${esc(it.name)}</td>
      <td class="num">${fmtQty(it.onHand, it.unit)}</td>
      <td><input type="number" min="0" step="any" data-close-id="${esc(id)}" value="${esc(typed[id] ?? "")}"
                 placeholder="${esc(it.unit)}" aria-label="Counted ${esc(it.name)}"></td>
    </tr>`).join("") || `<tr><td colspan="3" class="muted">No stock items.</td></tr>`;
}

$("saveCloseCountBtn").addEventListener("click", async () => {
  const entries = [...document.querySelectorAll("[data-close-id]")].filter((i) => i.value !== "");
  if (!entries.length) { $("closeCountMsg").textContent = "Type at least one counted amount."; return; }
  const batch = writeBatch(db);
  const record = {};
  for (const input of entries) {
    const id = input.dataset.closeId, counted = Number(input.value), it = state.inv[id];
    record[id] = { name: it.name, unit: it.unit, estimated: it.onHand, counted, avgCost: it.avgCost || 0 };
    batch.update(doc(db, "inventory", id), { onHand: counted });   // correct the estimate
  }
  batch.set(doc(db, "stockCounts", todayKey()),
    { closing: record, closingAt: Date.now(), closingBy: currentCode() }, { merge: true });
  try {
    await batch.commit();
    $("closeCountMsg").textContent = `Closing count saved (${entries.length} items).`;
    entries.forEach((i) => { i.value = ""; });
  } catch (err) { $("closeCountMsg").textContent = "Save failed: " + err.code; }
});

function renderGap() {
  const closing = state.counts[selDay()]?.closing;
  if (!closing) { $("gapBox").innerHTML = ""; return; }
  const rows = Object.values(closing).map((c) => ({ ...c, gap: c.estimated - c.counted }));
  const lost = rows.reduce((s, r) => s + Math.max(0, r.gap) * r.avgCost, 0);
  $("gapBox").innerHTML = `
    <h3 class="sub">Closing stock check</h3>
    <div class="table-wrap"><table class="data-table">
      <thead><tr><th>Item</th><th>Expected</th><th>Counted</th><th>Missing</th><th>Value</th></tr></thead>
      <tbody>${rows.map((r) => `
        <tr class="${r.gap > 0 ? "gap-bad" : ""}">
          <td>${esc(r.name)}</td>
          <td class="num">${fmtQty(r.estimated, r.unit)}</td>
          <td class="num">${fmtQty(r.counted, r.unit)}</td>
          <td class="num">${r.gap > 0 ? fmtQty(r.gap, r.unit) : "–"}</td>
          <td class="num">${r.gap > 0 ? rm(r.gap * r.avgCost) : "–"}</td>
        </tr>`).join("")}</tbody>
    </table></div>
    <p>Unaccounted stock: <b>${rm(lost)}</b>
      <span class="muted">(heavy pours, spills, freebies not entered, or recipes set too low)</span></p>`;
}

// ---------- Save the closing ----------
$("saveCloseBtn").addEventListener("click", async () => {
  const day = selDay();
  const data = { ...formClosing(), closedAt: Date.now(), closedBy: currentCode() };
  if (data.countedCash === null) { $("closeMsg").textContent = "Enter the cash counted in the box."; return; }
  try {
    await setDoc(doc(db, "days", day), data);
    $("closeMsg").textContent = `${dayLabel(day)} closed. You can download the report now.`;
  } catch (err) { $("closeMsg").textContent = "Save failed: " + err.code; }
});

$("dlClose").addEventListener("click", () => downloadDay(state, selDay()));

// ---------- Live summary of the form ----------
function renderSummary() {
  const day = selDay();
  const ds = daySales(state, day);
  const c = formClosing();
  const sal = salary(ds, c, state.settings);
  const cash = cashCheck(ds, c);
  const p = profit(ds, sal, state.settings, c);

  $("closeSummary").innerHTML = `
    <div class="close-grid">
      <div>
        <h3 class="sub">Cash box</h3>
        ${cash ? `
          <table class="data-table money">
            <tr><td>Float at opening</td><td class="num">${rm(cash.float)}</td></tr>
            <tr><td>+ Cash sales</td><td class="num">${rm(cash.cashSales)}</td></tr>
            <tr><td>= Expected</td><td class="num">${rm(cash.expected)}</td></tr>
            <tr><td>Counted</td><td class="num">${rm(cash.counted)}</td></tr>
            <tr class="total ${cash.diff < 0 ? "gap-bad" : ""}"><td>${cash.diff < 0 ? "Short" : cash.diff > 0 ? "Over" : "Exact"}</td>
              <td class="num">${rm(Math.abs(cash.diff))}</td></tr>
          </table>` : `<p class="muted">Enter the counted cash to check it.</p>`}
      </div>
      <div>
        <h3 class="sub">Salary</h3>
        ${sal.rows.length ? `
          <table class="data-table money">
            <tr><th>Name</th><th>Hrs</th><th>Hourly</th><th>Share</th><th>Total</th></tr>
            ${sal.rows.map((r) => `<tr><td>${esc(r.name)}</td><td class="num">${r.hours}</td>
              <td class="num">${rm(r.base)}</td><td class="num">${rm(r.share)}</td><td class="num"><b>${rm(r.total)}</b></td></tr>`).join("")}
            <tr class="total"><td colspan="4">Total</td><td class="num">${rm(sal.total)}</td></tr>
          </table>
          <p class="muted">Share pool: ${state.settings.sharePct}% of ${rm(ds.boothSales)} booth sales = ${rm(sal.pool)},
            split ${state.settings.shareSplit === "hours" ? "by hours" : "equally"}.</p>`
          : `<p class="muted">Enter hours to work out salary.</p>`}
      </div>
      <div>
        <h3 class="sub">Profit</h3>
        <table class="data-table money">
          <tr><td>Sales</td><td class="num">${rm(p.sales)}</td></tr>
          <tr><td>− Murukku (all to friend)</td><td class="num">${rm(p.friendSales)}</td></tr>
          <tr><td>− Stock used</td><td class="num">${rm(p.stockUsed)}</td></tr>
          <tr><td>− Salary</td><td class="num">${rm(p.salary)}</td></tr>
          <tr><td>− Booth fee</td><td class="num">${rm(p.boothFee)}</td></tr>
          <tr class="total"><td>Profit</td><td class="num">${rm(p.profit)}</td></tr>
        </table>
      </div>
    </div>`;
}
