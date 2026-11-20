// js/v2/admin/data.js
// One place that listens to Firestore for the admin screen.

import { db } from "../../firebase.js";
import { collection, doc, onSnapshot }
  from "https://www.gstatic.com/firebasejs/13.0.0/firebase-firestore.js";

export const DEFAULT_SETTINGS = {
  hourlyRate: 5,     // RM per hour
  sharePct: 5,       // % of all sales (whole event) shared between staff
  defaultFloat: 50,
  staff: [],
};

export const state = {
  menu: { items: [] },
  menuPending: false,
  orders: [],
  days: {},        // closings: { "2026-11-19": { float, countedCash, staff:[{name,hours}], note, extras? } }
  expenses: [],    // [{ id, date, what, amount, category, note, source, ... }]
  soldout: {},     // { itemId: { soldOut, by, at } }
  settings: { ...DEFAULT_SETTINGS },
};

const listeners = [];
export const onChange = (fn) => listeners.push(fn);
const emit = (what) => listeners.forEach((fn) => fn(what));

let unsubs = [];
export function startData(onError) {
  stopData();
  const err = (e) => { console.error(e); if (onError) onError(e); };

  unsubs.push(onSnapshot(doc(db, "menu", "main"), (snap) => {
    state.menuPending = snap.metadata.hasPendingWrites;
    state.menu = snap.exists() ? snap.data() : { items: [] };
    emit("menu");
  }, err));
  unsubs.push(onSnapshot(collection(db, "orders"), (snap) => {
    state.orders = snap.docs.map((d) => ({ id: d.id, ...d.data() })).sort((a, b) => a.createdAt - b.createdAt);
    emit("orders");
  }, err));
  unsubs.push(onSnapshot(collection(db, "days"), (snap) => {
    state.days = {};
    snap.docs.forEach((d) => { state.days[d.id] = d.data(); });
    emit("days");
  }, err));
  unsubs.push(onSnapshot(collection(db, "expenses"), (snap) => {
    state.expenses = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    emit("expenses");
  }, err));
  unsubs.push(onSnapshot(collection(db, "soldout"), (snap) => {
    state.soldout = {};
    snap.docs.forEach((d) => { state.soldout[d.id] = d.data(); });
    emit("soldout");
  }, err));
  unsubs.push(onSnapshot(doc(db, "settings", "main"), (snap) => {
    state.settings = { ...DEFAULT_SETTINGS, ...(snap.exists() ? snap.data() : {}) };
    emit("settings");
  }, err));
}
export function stopData() { unsubs.forEach((u) => u()); unsubs = []; }
