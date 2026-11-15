// js/admin/sales.js
// Overview tab (today at a glance) and Sales tab (any day, items, hours, the week, downloads).

import { rm, todayKey, esc } from "../utils.js";
import { state, onChange } from "./data.js";
import { allDays, daySales, salary, profit, stockLasts } from "./calc.js";
import { downloadDay, downloadWeek } from "./report.js";

const $ = (id) => document.getElementById(id);
const stat = (label, value, note = "") =>
  `<div class="stat"><span>${label}</span><b>${value}</b>${note ? `<small class="muted">${note}</small>` : ""}</div>`;

// "2026-11-16" -> "Mon 16 Nov"
export const dayLabel = (d) =>
  new Date(d + "T00:00:00").toLocaleDateString("en-MY", { weekday: "short", day: "numeric", month: "short" });

export function init() {
  onChange((what) => {
    if (["orders", "inv", "days", "settings"].includes(what)) { renderOverview(); renderSales(); }
  });
  $("salesDay").addEventListener("change", renderSales);
  $("dlDay").addEventListener("click", () => downloadDay(state, $("salesDay").value || todayKey()));
  $("dlWeek").addEventListener("click", () => downloadWeek(state));
  // keep "x minutes ago" and the time-based numbers fresh
  setInterval(renderOverview, 60 * 1000);
}

// ---------- Overview ----------
function renderOverview() {
  const day = todayKey();
  const ds = daySales(state, day);
  const closing = state.days[day];
  const sal = salary(ds, closing, state.settings);
  const p = profit(ds, sal, state.settings, closing);
  const preparing = state.orders.filter((o) => o.day === day && (o.status === "preparing" || o.status === "ready")).length;

  $("ovStats").innerHTML =
    stat("Sales today", rm(ds.sales)) +
    stat("Orders", ds.orders) +
    stat("Cash", rm(ds.cash)) +
    stat("QR", rm(ds.qr)) +
    stat("Murukku (friend's)", rm(ds.friendSales)) +
    stat("Free", ds.freeCount, ds.freeCount ? rm(ds.freeValue) + " value" : "") +
    stat("Voids", ds.voidCount, ds.voidCount ? rm(ds.voidValue) + " value" : "") +
    stat("In progress", preparing);

  $("ovProfit").innerHTML = `
    <table class="data-table money">
      <tr><td>Sales</td><td class="num">${rm(p.sales)}</td></tr>
      <tr><td>− Murukku (all to friend)</td><td class="num">${rm(p.friendSales)}</td></tr>
      <tr><td>− Stock used</td><td class="num">${rm(p.stockUsed)}</td></tr>
      <tr><td>− Salary ${closing ? "" : `<span class="muted">(after closing)</span>`}</td><td class="num">${rm(p.salary)}</td></tr>
      <tr><td>− Booth fee</td><td class="num">${rm(p.boothFee)}</td></tr>
      <tr><td>− Other costs ${closing ? "" : `<span class="muted">(after closing)</span>`}</td><td class="num">${rm(p.otherCosts)}</td></tr>
      <tr class="total"><td>${closing ? "Profit" : "Profit so far (before salary)"}</td><td class="num">${rm(p.profit)}</td></tr>
    </table>`;

  const low = stockLasts(state, day).filter((r) => r.low);
  $("ovLow").innerHTML = low.length
    ? low.map((r) => `<li class="${r.left <= 0 ? "out" : "low"}"><b>${esc(r.name)}</b>
        <span>${r.left <= 0 ? "Run out" : `${Math.round(r.left)} ${esc(r.unit)} left`}</span></li>`).join("")
    : `<li class="muted">Nothing is running low.</li>`;
}

// ---------- Sales ----------
function renderSales() {
  const days = allDays(state, todayKey());
  const keep = $("salesDay").value;
  $("salesDay").innerHTML = days.map((d) =>
    `<option value="${d}">${dayLabel(d)}${d === todayKey() ? " (today)" : ""}</option>`).join("");
  $("salesDay").value = days.includes(keep) ? keep : days[0];
  const day = $("salesDay").value;

  const ds = daySales(state, day);
  $("salesStats").innerHTML =
    stat("Sales", rm(ds.sales)) +
    stat("Booth sales", rm(ds.boothSales), "excl. murukku") +
    stat("Murukku", rm(ds.friendSales), "all to friend") +
    stat("Orders", ds.orders) +
    stat("Cash", rm(ds.cash)) +
    stat("QR", rm(ds.qr)) +
    stat("Free", ds.freeCount, ds.freeCount ? rm(ds.freeValue) + " value" : "") +
    stat("Voids", ds.voidCount, ds.voidCount ? rm(ds.voidValue) + " value" : "");

  // Items sold
  $("itemsBody").innerHTML = ds.items.length ? ds.items.map((r) => `
    <tr>
      <td><b>${esc(r.name)}</b>${r.size ? " " + esc(r.size) : ""}</td>
      <td class="num">${r.paidQty}${r.freeQty ? ` <span class="muted">+${r.freeQty} free</span>` : ""}</td>
      <td class="num">${r.friendItem ? "" : rm(r.sales)}</td>
      <td class="num">${r.friendItem ? rm(r.sales) : ""}</td>
    </tr>`).join("") + `
    <tr class="total"><td>Total</td><td class="num">${ds.items.reduce((s, r) => s + r.paidQty, 0)}</td>
      <td class="num">${rm(ds.boothSales)}</td><td class="num">${rm(ds.friendSales)}</td></tr>`
    : `<tr><td colspan="4" class="muted">No sales on this day.</td></tr>`;

  // Sales by hour: simple bars, scaled to the busiest hour
  const max = Math.max(1, ...ds.hourly.map((h) => h.sales));
  $("hourly").innerHTML = ds.hourly.length ? ds.hourly.map((h) => `
    <div class="hour-row">
      <span class="hour-label">${String(h.hour).padStart(2, "0")}:00</span>
      <span class="hour-bar"><span style="width:${(h.sales / max) * 100}%"></span></span>
      <span class="hour-val">${rm(h.sales)} · ${h.orders} order${h.orders === 1 ? "" : "s"}</span>
    </div>`).join("")
    : `<p class="muted">No sales on this day.</p>`;

  // The week, day by day
  const week = days.filter((d) => state.orders.some((o) => o.day === d) || state.days[d]).slice().reverse();
  $("weekBody").innerHTML = week.length ? week.map((d) => {
    const s = daySales(state, d), c = state.days[d];
    const sal = salary(s, c, state.settings), p = profit(s, sal, state.settings, c);
    return `
      <tr>
        <td>${dayLabel(d)}</td>
        <td class="num">${s.orders}</td>
        <td class="num">${rm(s.sales)}</td>
        <td class="num">${rm(s.friendSales)}</td>
        <td class="num">${rm(s.cash)}</td>
        <td class="num">${rm(s.qr)}</td>
        <td class="num">${c ? rm(p.profit) : `<span class="muted">not closed</span>`}</td>
      </tr>`;
  }).join("")
    : `<tr><td colspan="7" class="muted">No sales yet.</td></tr>`;
}
