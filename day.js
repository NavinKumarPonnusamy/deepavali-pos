// js/v2/admin/day.js — "Day" tab: one day's sales at a glance.
import { rm, todayKey, esc } from "../../utils.js";
import { state, onChange } from "./data.js";
import { allDays, daySales, expensesOn } from "./calc.js";
import { dayReport } from "./report.js";

const $ = (id) => document.getElementById(id);
let picked = null;

export function init() {
  onChange((w) => { if (["orders", "days", "expenses"].includes(w)) render(); });
  $("dayPick").addEventListener("change", () => { picked = $("dayPick").value; render(); });
  $("dlDay").addEventListener("click", () => dayReport(picked || todayKey()));
}

const nice = (d) => new Date(d + "T00:00").toLocaleDateString("en-MY", { weekday: "short", day: "numeric", month: "short" });
const stat = (label, value, small = "") => `<div class="stat"><span>${label}</span><b>${value}</b>${small ? `<small class="muted">${small}</small>` : ""}</div>`;

function render() {
  const today = todayKey();
  const days = allDays(state, today);
  if (!picked || !days.includes(picked)) picked = today;
  $("dayPick").innerHTML = days.map((d) => `<option value="${d}" ${d === picked ? "selected" : ""}>${nice(d)}${d === today ? " (today)" : ""}</option>`).join("");

  const ds = daySales(state, picked);
  $("dayStats").innerHTML = [
    stat("Sales", rm(ds.sales)),
    stat("Average order", rm(ds.avgOrder)),
    stat("Cash", rm(ds.cash)),
    stat("TNG", rm(ds.tng)),
    stat("Orders", ds.orders),
    stat("Free", ds.freeCount, ds.freeCount ? rm(ds.freeValue) + " value" : ""),
    stat("Voids", ds.voidCount),
    stat("Expenses this day", rm(expensesOn(state, picked))),
  ].join("");

  $("itemsBody").innerHTML = ds.items.length ? ds.items.map((r) => `
    <tr><td><b>${esc(r.name)}</b> ${r.label ? `<span class="muted">${esc(r.label)}</span>` : ""}
      ${r.freeQty ? ` <span class="tagpill">${r.freeQty} free</span>` : ""}</td>
      <td class="num">${r.qty}</td><td class="num">${rm(r.sales)}</td></tr>`).join("")
    : `<tr><td colspan="3" class="muted">No sales this day.</td></tr>`;

  const max = Math.max(1, ...ds.hourly.map((h) => h.sales));
  $("hourly").innerHTML = ds.hourly.length ? ds.hourly.map((h) => `
    <div class="hour-row"><span class="hour-label">${String(h.hour).padStart(2, "0")}:00</span>
      <span class="hour-bar"><span style="width:${Math.round(h.sales / max * 100)}%"></span></span>
      <span class="hour-val">${rm(h.sales)} · ${h.orders}</span></div>`).join("")
    : `<p class="muted">No sales this day.</p>`;
}
