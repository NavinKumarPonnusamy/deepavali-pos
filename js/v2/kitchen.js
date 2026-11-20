// js/v2/kitchen.js
// Kitchen screen. Pick a station (Drinks or Snacks) and see only what you need to make,
// oldest first. Tap Done when it's handed over. A beep plays when a new order arrives.

import { db } from "../firebase.js";
import { collection, doc, onSnapshot, query, where, writeBatch }
  from "https://www.gstatic.com/firebasejs/13.0.0/firebase-firestore.js";
import { startAuth, logout, currentCode, emailToCode } from "../auth-gate.js";
import { todayKey, timeOf, esc } from "../utils.js";

const $ = (id) => document.getElementById(id);
const KEY = "cupcha-station";
let station = "drinks";
try { station = localStorage.getItem(KEY) || "drinks"; } catch (e) { /* ignore */ }
let orders = [];
let seen = null;          // order ids already seen (so only NEW ones beep)
let sound = false;
let day = todayKey();
let unsubs = [];

startAuth({
  onSignedIn: (user) => { $("who").textContent = emailToCode(user.email); listen(); },
  onSignedOut: () => { unsubs.forEach((u) => u()); unsubs = []; },
});
$("logoutBtn").addEventListener("click", logout);

function listen() {
  unsubs.forEach((u) => u()); unsubs = [];
  const q = query(collection(db, "orders"), where("day", "==", day));
  unsubs.push(onSnapshot(q, (snap) => {
    orders = snap.docs.map((d) => ({ id: d.id, ...d.data() })).sort((a, b) => a.createdAt - b.createdAt);
    beepForNew();
    render();
  }, (err) => { $("kMsg").textContent = "Problem loading orders: " + (err.code || err.message); }));
}

// ---------- what this station has to make in an order ----------
function partsFor(o, st) {
  const out = [];
  for (const l of o.items || []) {
    if (l.station === st) out.push({ qty: l.qty, name: l.name, label: l.label || "" });
    for (const p of l.parts || []) if (p.station === st) out.push({ qty: l.qty, name: p.name, label: p.label || "", combo: l.name });
  }
  return out;
}
const field = (st) => st + "Done";
const waitingFor = (st) => orders.filter((o) => o.status === "preparing" && o[field(st)] === false);
const doneFor = (st) => orders.filter((o) => o.status !== "void" && o[field(st)] === true)
  .sort((a, b) => (b[st + "DoneAt"] || 0) - (a[st + "DoneAt"] || 0)).slice(0, 8);

// ---------- tabs ----------
document.querySelector(".k-tabs").addEventListener("click", (e) => {
  const b = e.target.closest("[data-st]"); if (!b) return;
  station = b.dataset.st;
  try { localStorage.setItem(KEY, station); } catch (err) { /* ignore */ }
  seen = new Set(waitingFor(station).map((o) => o.id));
  render();
});

function ago(ms) { const m = Math.floor((Date.now() - ms) / 60000); return m < 1 ? "just now" : m + " min ago"; }

function render() {
  document.querySelectorAll(".k-tab").forEach((b) => {
    const on = b.dataset.st === station;
    b.classList.toggle("active", on); b.setAttribute("aria-selected", on);
  });
  ["drinks", "snacks"].forEach((st) => { $("cnt-" + st).textContent = waitingFor(st).length || ""; });

  const list = waitingFor(station);
  $("kList").innerHTML = list.length ? list.map((o, i) => {
    const mins = (Date.now() - o.createdAt) / 60000;
    return `
    <li class="k-card ${i === 0 ? "first" : ""} ${mins >= 8 ? "late" : ""}">
      <div class="k-top"><b class="k-name">${esc(o.name) || "No name"}</b>
        <span class="muted">${timeOf(o.createdAt)} · ${ago(o.createdAt)}</span></div>
      <ul class="k-items">${partsFor(o, station).map((p) => `
        <li><b>${p.qty}×</b> ${esc(p.name)}${p.label ? ` <small>${esc(p.label)}</small>` : ""}${p.combo ? ` <span class="tagpill">${esc(p.combo)}</span>` : ""}</li>`).join("")}</ul>
      <button class="btn primary big k-btn" type="button" data-done="${o.id}">Done · handed over</button>
    </li>`;
  }).join("") : `<li class="k-empty">Nothing to make right now.</li>`;

  $("kDone").innerHTML = doneFor(station).map((o) => `
    <li class="order-row"><div><b>${esc(o.name) || "No name"}</b> <span class="muted">${timeOf(o[station + "DoneAt"] || o.createdAt)}</span></div>
      <div class="muted">${partsFor(o, station).map((p) => `${p.qty}× ${esc(p.name)}`).join(", ")}</div>
      ${o.status === "collected" && otherDone(o) && o.collectedAt && Date.now() - o.collectedAt > 10 * 60000 ? "" :
        `<button class="btn small ghost" type="button" data-undo="${o.id}">Undo</button>`}</li>`).join("") || `<li class="muted">Nothing yet.</li>`;
}
const other = (st) => (st === "drinks" ? "snacks" : "drinks");
const otherDone = (o) => o[field(other(station))] !== false;   // null (not needed) or true

$("kList").addEventListener("click", (e) => {
  const b = e.target.closest("[data-done]"); if (!b) return;
  const o = orders.find((x) => x.id === b.dataset.done); if (!o) return;
  const upd = { [field(station)]: true, [station + "DoneAt"]: Date.now() };
  if (otherDone(o)) { upd.status = "collected"; upd.collectedAt = Date.now(); }   // last station finishes the order
  const batch = writeBatch(db); batch.update(doc(db, "orders", o.id), upd);
  batch.commit().catch((err) => { $("kMsg").textContent = "Couldn't save: " + (err.code || err.message) + ". Rules updated?"; });
});
$("kDone").addEventListener("click", (e) => {
  const b = e.target.closest("[data-undo]"); if (!b) return;
  const batch = writeBatch(db);
  batch.update(doc(db, "orders", b.dataset.undo), { [field(station)]: false, [station + "DoneAt"]: null, status: "preparing", collectedAt: null });
  batch.commit().catch((err) => { $("kMsg").textContent = "Couldn't undo: " + (err.code || err.message); });
});
setInterval(render, 30000);

// ---------- sound ----------
let ctx = null;
$("soundBtn").addEventListener("click", () => {
  sound = !sound;
  if (sound) { ctx = ctx || new (window.AudioContext || window.webkitAudioContext)(); ctx.resume(); beep(); }
  $("soundBtn").textContent = sound ? "Sound on ✓" : "Turn on sound";
  $("soundBtn").classList.toggle("primary", sound);
});
function beep() {
  if (!sound || !ctx) return;
  [0, 0.18].forEach((t) => {
    const o = ctx.createOscillator(), g = ctx.createGain();
    o.frequency.value = 880; o.type = "sine";
    g.gain.setValueAtTime(0.0001, ctx.currentTime + t);
    g.gain.exponentialRampToValueAtTime(0.3, ctx.currentTime + t + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + t + 0.15);
    o.connect(g).connect(ctx.destination); o.start(ctx.currentTime + t); o.stop(ctx.currentTime + t + 0.16);
  });
  if (navigator.vibrate) navigator.vibrate(150);
}
function beepForNew() {
  const ids = waitingFor(station).map((o) => o.id);
  if (seen === null) { seen = new Set(ids); return; }      // first load: no beep
  if (ids.some((id) => !seen.has(id))) beep();
  seen = new Set(ids);
}
