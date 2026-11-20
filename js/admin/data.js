// js/admin/data.js
// One place that listens to Firestore for the whole admin dashboard.
// Every tab reads from `state` and gets told when something changes,
// so the same data is never downloaded twice.

import { db } from "../firebase.js";
import { collection, doc, onSnapshot }
  from "https://www.gstatic.com/firebasejs/13.0.0/firebase-firestore.js";

export const DEFAULT_SETTINGS = {
  hourlyRate: 5,        // RM per hour, per person
  sharePct: 5,          // % of booth sales (murukku excluded) shared with staff
  shareSplit: "equal",  // "equal" or "hours"
  boothFee: 60,         // RM per normal booth day (RM300 for 5 weekdays)
  eventDay: "2026-11-21",  // Deepavali Night
  eventBoothFee: 150,   // RM for the event day
  defaultFloat: 50,     // RM of change in the cash box at opening
  staff: [],            // names shown in the closing form
};

export const state = {
  menu: { items: [], floorMode: false },
  menuPending: false,   // true while our own menu save is on its way
  inv: {},              // stock items      { id: {...} }
  orders: [],           // ALL orders (a booth week is a few hundred, small enough)
  purchases: [],        // all purchases
  counts: {},           // stock counts     { "2026-11-16": { opening, closing, ... } }
  days: {},             // daily closings   { "2026-11-16": { float, countedCash, staff, ... } }
  settings: { ...DEFAULT_SETTINGS },
};

// ---------- change notifications ----------
const listeners = [];
// fn(what) is called with "menu", "inv", "orders", "purchases", "counts", "days" or "settings"
export const onChange = (fn) => listeners.push(fn);
const emit = (what) => listeners.forEach((fn) => fn(what));

let unsubs = [];

export function startData(onError) {
  stopData();
  const err = (e) => { console.error(e); if (onError) onError(e); };

  unsubs.push(onSnapshot(doc(db, "menu", "main"), (snap) => {
    state.menuPending = snap.metadata.hasPendingWrites;
    state.menu = snap.exists() ? snap.data() : { items: [], floorMode: false };
    emit("menu");
  }, err));

  unsubs.push(onSnapshot(collection(db, "inventory"), (snap) => {
    state.inv = {};
    snap.docs.forEach((d) => { state.inv[d.id] = d.data(); });
    emit("inv");
  }, err));

  unsubs.push(onSnapshot(collection(db, "orders"), (snap) => {
    state.orders = snap.docs.map((d) => ({ id: d.id, ...d.data() }))
      .sort((a, b) => a.createdAt - b.createdAt);
    emit("orders");
  }, err));

  unsubs.push(onSnapshot(collection(db, "purchases"), (snap) => {
    state.purchases = snap.docs.map((d) => ({ id: d.id, ...d.data() }))
      .sort((a, b) => a.at - b.at);
    emit("purchases");
  }, err));

  unsubs.push(onSnapshot(collection(db, "stockCounts"), (snap) => {
    state.counts = {};
    snap.docs.forEach((d) => { state.counts[d.id] = d.data(); });
    emit("counts");
  }, err));

  unsubs.push(onSnapshot(collection(db, "days"), (snap) => {
    state.days = {};
    snap.docs.forEach((d) => { state.days[d.id] = d.data(); });
    emit("days");
  }, err));

  unsubs.push(onSnapshot(doc(db, "settings", "main"), (snap) => {
    state.settings = { ...DEFAULT_SETTINGS, ...(snap.exists() ? snap.data() : {}) };
    emit("settings");
  }, err));
}

export function stopData() {
  unsubs.forEach((u) => u());
  unsubs = [];
}
