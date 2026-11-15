// js/admin/stock.js
// Stock tab: what needs buying, how long stock lasts, purchases, opening count, stock items.
// (The closing count lives in the Closing tab.)

import { db } from "../firebase.js";
import { collection, doc, addDoc, updateDoc, deleteDoc, writeBatch, runTransaction }
  from "https://www.gstatic.com/firebasejs/13.0.0/firebase-firestore.js";
import { currentCode } from "../auth-gate.js";
import { rm, todayKey, timeOf, esc } from "../utils.js";
import { fmtQty } from "../stock-math.js";
import { state, onChange } from "./data.js";
import { stockLasts, canMake } from "./calc.js";

const $ = (id) => document.getElementById(id);
const sortedInv = () => Object.entries(state.inv).sort((a, b) => a[1].name.localeCompare(b[1].name));
let deletingId = null;

export function init() {
  onChange((what) => {
    if (["inv", "orders", "menu"].includes(what)) { renderTopup(); renderLasts(); renderCanMake(); }
    if (what === "inv") { renderBuySelect(); renderOpening(); }
    if (what === "inv" || what === "menu") renderInvTable();
    if (what === "purchases") renderPurchases();
  });
  // "How long it lasts" depends on the clock too, so refresh it every 5 minutes.
  setInterval(renderLasts, 5 * 60 * 1000);
}

// ---------- Needs topping up ----------
function renderTopup() {
  const low = sortedInv().filter(([, it]) => it.onHand <= 0 || (it.lowAt > 0 && it.onHand <= it.lowAt));
  $("topup").innerHTML = low.length
    ? low.map(([, it]) => `
        <li class="${it.onHand <= 0 ? "out" : "low"}">
          <b>${esc(it.name)}</b>
          <span>${it.onHand <= 0 ? "Run out" : `About ${fmtQty(it.onHand, it.unit)} left`}</span>
          ${it.lowAt > 0 ? `<span class="muted">(warn below ${fmtQty(it.lowAt, it.unit)})</span>` : ""}
        </li>`).join("")
    : `<li class="muted">Nothing is running low.</li>`;
}

// ---------- How long stock lasts ----------
const fmtDays = (d) => d >= 10 ? "10+ days" : d >= 1 ? `about ${Math.round(d * 10) / 10} days` : `under a day`;
const fmtHours = (h) => h >= 24 ? "a day or more" : h >= 1 ? `about ${Math.round(h)} hrs` : `under an hour`;

function renderLasts() {
  const rows = stockLasts(state, todayKey());
  $("lastsBody").innerHTML = rows.length ? rows.map((r) => `
    <tr class="${r.low ? "gap-bad" : ""}">
      <td><b>${esc(r.name)}</b></td>
      <td class="num">${fmtQty(r.left, r.unit)}</td>
      <td class="num">${fmtQty(r.usedToday, r.unit)}</td>
      <td class="num">${r.perDay !== null ? fmtQty(r.perDay, r.unit) : "–"}</td>
      <td>${r.daysLeft !== null ? fmtDays(r.daysLeft) : `<span class="muted">needs a full day of sales</span>`}</td>
      <td>${r.hoursLeft !== null ? fmtHours(r.hoursLeft) : "–"}</td>
    </tr>`).join("")
    : `<tr><td colspan="6" class="muted">Add stock items first.</td></tr>`;
}

function renderCanMake() {
  const rows = canMake(state);
  $("canMake").innerHTML = rows.length
    ? rows.map((r) => `
        <li class="${r.n === 0 ? "out" : r.n < 10 ? "low" : ""}">
          <b>${esc(r.name)}${r.size ? " " + esc(r.size) : ""}</b> <span>${r.n}</span>
          ${r.active ? "" : `<span class="muted">(hidden)</span>`}
        </li>`).join("")
    : `<li class="muted">No recipes yet. Add them in the Menu tab.</li>`;
}

// ---------- Purchases ----------
function renderBuySelect() {
  const keep = $("pInv").value;
  $("pInv").innerHTML = `<option value="">Pick…</option>` +
    sortedInv().map(([id, it]) => `<option value="${esc(id)}">${esc(it.name)}</option>`).join("");
  $("pInv").value = state.inv[keep] ? keep : "";
  updatePreview();
}

function updatePreview() {
  const it = state.inv[$("pInv").value];
  $("pUnitLabel").textContent = it ? `(in ${it.unit})` : "";
  const packs = Number($("pPacks").value), size = Number($("pSize").value), price = Number($("pPrice").value);
  if (!it || !(packs > 0) || !(size > 0) || $("pPrice").value === "") { $("pPreview").textContent = ""; return; }
  const added = packs * size;
  $("pPreview").textContent =
    `Adds ${fmtQty(added, it.unit)} · RM${(price / added).toFixed(4)} per ${it.unit === "pcs" ? "piece" : it.unit}.`;
}
["pInv", "pPacks", "pSize", "pPrice"].forEach((id) => $(id).addEventListener("input", updatePreview));

$("buyForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const id = $("pInv").value;
  const packs = Number($("pPacks").value), size = Number($("pSize").value), price = Number($("pPrice").value);
  if (!state.inv[id] || !(packs > 0) || !(size > 0) || !(price >= 0)) { $("buyMsg").textContent = "Fill in every box."; return; }
  const added = packs * size;
  try {
    // A transaction reads the latest stock and writes the new numbers in one go,
    // so a sale happening at the same moment can't get lost.
    await runTransaction(db, async (tx) => {
      const ref = doc(db, "inventory", id);
      const cur = (await tx.get(ref)).data();
      const have = Math.max(0, cur.onHand || 0);   // a negative estimate means "really none left"
      const onHand = have + added;
      // Weighted average: old stock at old price + new stock at new price
      const avgCost = onHand > 0 ? (have * (cur.avgCost || 0) + price) / onHand : 0;
      tx.update(ref, { onHand, baseline: onHand, avgCost });
      tx.set(doc(collection(db, "purchases")), {
        invId: id, name: cur.name, unit: cur.unit,
        packs, packSize: size, qty: added, price, unitCost: price / added,
        day: todayKey(), at: Date.now(), by: currentCode(),
      });
    });
    $("buyMsg").textContent = `Added ${fmtQty(added, state.inv[id].unit)} of ${state.inv[id].name}.`;
    $("pPacks").value = 1; $("pSize").value = ""; $("pPrice").value = "";
    updatePreview();
  } catch (err) { showError(err, "buyMsg"); }
});

function renderPurchases() {
  const today = state.purchases.filter((p) => p.day === todayKey()).reverse();
  $("purchaseList").innerHTML = today.length
    ? today.map((p) => `
        <li class="order-row">
          <div><b>${esc(p.name)}</b> · ${p.packs} × ${fmtQty(p.packSize, p.unit)} · <b>${rm(p.price)}</b></div>
          <div class="muted">${timeOf(p.at)} by ${esc(p.by)} · RM${p.unitCost.toFixed(4)} per ${esc(p.unit)}</div>
        </li>`).join("")
    : `<li class="muted">No purchases logged today.</li>`;
}

// ---------- Opening count ----------
function renderOpening() {
  const typed = {};
  document.querySelectorAll("[data-open-id]").forEach((i) => { typed[i.dataset.openId] = i.value; });
  $("openBody").innerHTML = sortedInv().map(([id, it]) => `
    <tr>
      <td>${esc(it.name)}</td>
      <td class="num">${fmtQty(it.onHand, it.unit)}</td>
      <td><input type="number" min="0" step="any" data-open-id="${esc(id)}" value="${esc(typed[id] ?? "")}"
                 placeholder="${esc(it.unit)}" aria-label="Counted ${esc(it.name)}"></td>
    </tr>`).join("") || `<tr><td colspan="3" class="muted">Add stock items first.</td></tr>`;
}

$("saveOpenBtn").addEventListener("click", async () => {
  const entries = [...document.querySelectorAll("[data-open-id]")].filter((i) => i.value !== "");
  if (!entries.length) { $("openMsg").textContent = "Type at least one counted amount."; return; }
  const day = todayKey();
  const batch = writeBatch(db);
  const record = {};
  for (const input of entries) {
    const id = input.dataset.openId, counted = Number(input.value), it = state.inv[id];
    record[id] = { name: it.name, unit: it.unit, estimated: it.onHand, counted, avgCost: it.avgCost || 0 };
    // Counted amount becomes the new level AND "full" on the cashier bars.
    batch.update(doc(db, "inventory", id), { onHand: counted, baseline: counted });
  }
  batch.set(doc(db, "stockCounts", day),
    { opening: record, openingAt: Date.now(), openingBy: currentCode() }, { merge: true });
  try {
    await batch.commit();
    $("openMsg").textContent = `Opening count saved (${entries.length} items). The cashier bars are full again.`;
    entries.forEach((i) => { i.value = ""; });
  } catch (err) { showError(err, "openMsg"); }
});

// ---------- Stock items ----------
function usedBy(id) {
  return (state.menu.items || []).filter((it) => it.sizes.some((s) => (s.recipe || []).some((p) => p.inv === id)))
    .map((it) => it.name);
}

function renderInvTable() {
  $("invBody").innerHTML = sortedInv().map(([id, it]) => {
    const users = usedBy(id);
    const del = deletingId === id
      ? (users.length
          ? `<span class="error">Used by ${esc(users.join(", "))}. Remove it from those recipes first.</span>
             <button class="btn small ghost" type="button" data-del-no>OK</button>`
          : `<button class="btn small danger" type="button" data-del-yes="${esc(id)}">Delete</button>
             <button class="btn small ghost" type="button" data-del-no>Keep</button>`)
      : `<button class="btn small ghost" type="button" data-del="${esc(id)}">Delete</button>`;
    return `
      <tr>
        <td><b>${esc(it.name)}</b></td>
        <td class="num">${fmtQty(it.onHand, it.unit)}</td>
        <td><input type="number" min="0" step="any" class="low-input" data-low="${esc(id)}" value="${it.lowAt || ""}"
                   aria-label="Warn below for ${esc(it.name)}"> <span class="muted">${esc(it.unit)}</span></td>
        <td class="num">RM${(it.avgCost || 0).toFixed(4)}</td>
        <td class="num">${rm(Math.max(0, it.onHand) * (it.avgCost || 0))}</td>
        <td>${del}</td>
      </tr>`;
  }).join("") || `<tr><td colspan="6" class="muted">No stock items yet. Add your first one below.</td></tr>`;
}

$("invBody").addEventListener("change", (e) => {
  const id = e.target.dataset.low;
  if (id) updateDoc(doc(db, "inventory", id), { lowAt: Number(e.target.value) || 0 }).catch((err) => showError(err, "addMsg"));
});

$("invBody").addEventListener("click", (e) => {
  const start = e.target.closest("[data-del]");
  const yes = e.target.closest("[data-del-yes]");
  const no = e.target.closest("[data-del-no]");
  if (start) { deletingId = start.dataset.del; renderInvTable(); }
  if (no) { deletingId = null; renderInvTable(); }
  if (yes) { deleteDoc(doc(db, "inventory", yes.dataset.delYes)).catch((err) => showError(err, "addMsg")); deletingId = null; }
});

$("addInvForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const name = $("newName").value.trim();
  if (!name) return;
  if (Object.values(state.inv).some((it) => it.name.toLowerCase() === name.toLowerCase())) {
    $("addMsg").textContent = `"${name}" already exists.`; return;
  }
  try {
    await addDoc(collection(db, "inventory"), {
      name, unit: $("newUnit").value, lowAt: Number($("newLow").value) || 0,
      onHand: 0, baseline: 0, avgCost: 0,
    });
    $("newName").value = ""; $("newLow").value = ""; $("addMsg").textContent = `Added ${name}. Log a purchase to give it stock and a cost.`;
  } catch (err) { showError(err, "addMsg"); }
});

function showError(err, where) {
  console.error(err);
  $(where).textContent = "Something went wrong: " + (err.code || err.message);
}
