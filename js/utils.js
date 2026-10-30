// js/utils.js
// Small helpers shared by every screen.

// Money: 4 -> "RM4.00"
export const rm = (n) => "RM" + (Number(n) || 0).toFixed(2);

// Avoid floating-point mess: 0.1 + 0.2 = 0.30000000000000004 -> 0.3
export const round2 = (n) => Math.round(n * 100) / 100;

// Today's date as "2026-11-02", using the device's local time (Malaysia).
// Every order stores this, so "today's orders" is a simple filter.
export function todayKey(d = new Date()) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

// "14:05" from a timestamp in milliseconds
export const timeOf = (ms) =>
  new Date(ms).toLocaleTimeString("en-MY", { hour: "2-digit", minute: "2-digit", hour12: false });

// Escape text before putting it inside innerHTML.
// Customer names are typed by people, so never trust them as HTML.
export const esc = (s) =>
  String(s ?? "").replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

// "2× Tara (L), 1× Chai"
export const itemsSummary = (items) =>
  items.map((i) => `${i.qty}× ${i.name}${i.size ? ` (${i.size})` : ""}`).join(", ");
