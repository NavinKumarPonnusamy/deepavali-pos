// js/admin/report.js
// Builds the Excel audit reports with SheetJS (window.XLSX, loaded by admin.html).
// Each sheet is an "array of arrays": one inner array per row.

import { timeOf, itemsSummary, todayKey } from "../utils.js";
import { allDays, daySales, salary, cashCheck, profit, stockDay } from "./calc.js";

const r2 = (n) => Math.round((Number(n) || 0) * 100) / 100;

function sheet(rows, widths) {
  const ws = window.XLSX.utils.aoa_to_sheet(rows);
  if (widths) ws["!cols"] = widths.map((w) => ({ wch: w }));
  return ws;
}

function save(wb, filename) {
  if (!window.XLSX) { alertMissing(); return; }
  window.XLSX.writeFile(wb, filename);
}
function alertMissing() {
  const msg = document.getElementById("reportMsg");
  if (msg) msg.textContent = "The Excel library didn't load. Check the internet connection and refresh.";
}

// ---------- One day ----------
export function buildDay(state, day) {
  const X = window.XLSX;
  const wb = X.utils.book_new();
  const ds = daySales(state, day);
  const closing = state.days[day];
  const sal = salary(ds, closing, state.settings);
  const cash = cashCheck(ds, closing);
  const p = profit(ds, sal, state.settings, closing);
  const stock = stockDay(state, day);
  const missingRM = r2(stock.reduce((s, r) => s + r.missingRM, 0));
  const purchases = state.purchases.filter((x) => x.day === day);

  // 1. Summary
  X.utils.book_append_sheet(wb, sheet([
    ["Daily sales report", day],
    ["Closed", closing ? `${new Date(closing.closedAt).toLocaleString("en-MY")} by ${closing.closedBy}` : "NOT CLOSED YET"],
    [],
    ["SALES", "RM"],
    ["Total sales", ds.sales],
    ["  Booth sales (excl. murukku)", ds.boothSales],
    ["  Murukku sales (all owed to friend)", ds.friendSales],
    ["  Cash", ds.cash],
    ["  QR", ds.qr],
    ["Orders (excl. voids)", ds.orders],
    ["Free orders", ds.freeCount, "menu value", ds.freeValue],
    ["Voided orders", ds.voidCount, "menu value", ds.voidValue],
    [],
    ["PROFIT", "RM"],
    ["Total sales", p.sales],
    ["− Murukku paid to friend", -p.friendSales],
    ["− Stock used (from recipes)", -p.stockUsed],
    ["− Salary", -p.salary],
    ["− Booth fee", -p.boothFee],
    ["− Other costs (see below)", -p.otherCosts],
    ["= Profit", p.profit],
    [],
    ["CASH CHECK", "RM"],
    ...(cash ? [
      ["Float at opening", cash.float],
      ["+ Cash sales", cash.cashSales],
      ["= Expected in cash box", cash.expected],
      ["Counted at closing", cash.counted],
      ["Difference (− = short)", cash.diff],
    ] : [["Not recorded"]]),
    [],
    ["STOCK", "RM"],
    ["Bought today", r2(purchases.reduce((s, x) => s + x.price, 0))],
    ["Unaccounted at closing count", missingRM],
    [],
    ["OTHER COSTS", "RM"],
    ...((closing?.extras || []).length ? closing.extras.map((x) => [x.what, x.amount]) : [["None entered"]]),
    [],
    ["Note", closing?.note || ""],
  ], [38, 16, 12, 12]), "Summary");

  // 2. Every order, voids included
  X.utils.book_append_sheet(wb, sheet([
    ["No", "Time", "Customer", "Items", "Payment", "Menu value (RM)", "Paid (RM)", "Status", "Free reason", "Void reason", "Taken by", "Voided by"],
    ...ds.all.map((o) => [o.no, timeOf(o.createdAt), o.name || "", itemsSummary(o.items), o.pay,
      o.listTotal, o.total, o.status, o.freeReason || "", o.voidReason || "", o.by || "", o.voidedBy || ""]),
  ], [5, 7, 14, 40, 8, 14, 10, 10, 18, 18, 10, 10]), "Orders");

  // 3. Items sold
  X.utils.book_append_sheet(wb, sheet([
    ["Item", "Size", "Price (RM)", "Paid qty", "Free qty", "Booth sales (RM)", "Murukku sales (RM)", "Stock cost (RM)"],
    ...ds.items.map((r) => [r.name, r.size, r.price, r.paidQty, r.freeQty,
      r.friendItem ? 0 : r.sales, r.friendItem ? r.sales : 0, r.friendItem ? 0 : r.cost]),
    ["Total", "", "", ds.items.reduce((s, r) => s + r.paidQty, 0), ds.items.reduce((s, r) => s + r.freeQty, 0),
      ds.boothSales, ds.friendSales, ds.stockUsed],
  ], [18, 6, 10, 9, 9, 16, 18, 14]), "Items sold");

  // 4. Sales by hour
  X.utils.book_append_sheet(wb, sheet([
    ["Hour", "Orders", "Sales (RM)"],
    ...ds.hourly.map((h) => [`${String(h.hour).padStart(2, "0")}:00`, h.orders, h.sales]),
  ], [8, 8, 12]), "By hour");

  // 5. Salary
  X.utils.book_append_sheet(wb, sheet([
    ["Rule", `RM${state.settings.hourlyRate}/hr + ${state.settings.sharePct}% of booth sales (excl. murukku), split ${state.settings.shareSplit === "hours" ? "by hours" : "equally"}`],
    ["Share pool (RM)", sal.pool],
    [],
    ["Name", "Hours", "Hourly pay (RM)", "Share (RM)", "Total (RM)"],
    ...sal.rows.map((r) => [r.name, r.hours, r.base, r.share, r.total]),
    ["Total", sal.rows.reduce((s, r) => s + r.hours, 0), r2(sal.rows.reduce((s, r) => s + r.base, 0)),
      r2(sal.rows.reduce((s, r) => s + r.share, 0)), sal.total],
  ], [14, 8, 16, 12, 12]), "Salary");

  // 6. Murukku
  const muru = ds.items.filter((r) => r.friendItem);
  X.utils.book_append_sheet(wb, sheet([
    ["Item", "Size", "Price (RM)", "Paid qty", "Free qty", "Sales (RM)"],
    ...muru.map((r) => [r.name, r.size, r.price, r.paidQty, r.freeQty, r.sales]),
    ["Total owed to friend", "", "", "", "", ds.friendSales],
  ], [18, 8, 10, 9, 9, 12]), "Murukku");

  // 7. Stock movement
  X.utils.book_append_sheet(wb, sheet([
    ["Item", "Unit", "Opening count", "Bought", "Bought (RM)", "Used (est.)", "Used (RM)",
      "Expected at close", "Counted at close", "Missing", "Missing (RM)"],
    ...stock.map((r) => [r.name, r.unit, r.opening ?? "", r.boughtQty, r.boughtRM, r.used, r.usedRM,
      r.expected ?? "", r.counted ?? "", r.missing, r.missingRM]),
  ], [18, 6, 13, 9, 11, 11, 10, 16, 15, 9, 12]), "Stock");

  // 8. Purchases
  X.utils.book_append_sheet(wb, sheet([
    ["Time", "Item", "Packs", "Size of one", "Unit", "Total qty", "Price (RM)", "Cost per unit (RM)", "Logged by"],
    ...purchases.map((x) => [timeOf(x.at), x.name, x.packs, x.packSize, x.unit, x.qty, x.price,
      Math.round(x.unitCost * 10000) / 10000, x.by]),
  ], [7, 18, 7, 11, 6, 10, 11, 17, 10]), "Purchases");

  return wb;
}

export function downloadDay(state, day) {
  if (!window.XLSX) return alertMissing();
  save(buildDay(state, day), `booth-report-${day}.xlsx`);
}

// ---------- The whole week ----------
export function downloadWeek(state) {
  const X = window.XLSX;
  if (!X) return alertMissing();
  const days = allDays(state, todayKey()).filter((d) => state.orders.some((o) => o.day === d) || state.days[d]).reverse();
  const rows = [["Date", "Orders", "Sales", "Booth sales", "Murukku (to friend)", "Cash", "QR", "Free orders",
    "Voids", "Stock used", "Salary", "Booth fee", "Other costs", "Profit", "Cash difference", "Closed"]];
  const tot = Array(14).fill(0);
  for (const d of days) {
    const ds = daySales(state, d), c = state.days[d];
    const sal = salary(ds, c, state.settings), p = profit(ds, sal, state.settings, c), cash = cashCheck(ds, c);
    const row = [ds.orders, ds.sales, ds.boothSales, ds.friendSales, ds.cash, ds.qr, ds.freeCount,
      ds.voidCount, ds.stockUsed, sal.total, p.boothFee, p.otherCosts, p.profit, cash ? cash.diff : 0];
    row.forEach((v, i) => { tot[i] = r2(tot[i] + v); });
    rows.push([d, ...row, c ? "yes" : "NO"]);
  }
  rows.push(["Total", ...tot, ""]);

  const wb = X.utils.book_new();
  X.utils.book_append_sheet(wb, sheet(rows, [12, 8, 10, 12, 18, 10, 10, 11, 7, 11, 10, 10, 12, 10, 15, 8]), "Week");
  const all = state.orders.filter((o) => days.includes(o.day));
  X.utils.book_append_sheet(wb, sheet([
    ["Date", "No", "Time", "Customer", "Items", "Payment", "Menu value (RM)", "Paid (RM)", "Status", "Void reason", "Taken by"],
    ...all.map((o) => [o.day, o.no, timeOf(o.createdAt), o.name || "", itemsSummary(o.items), o.pay,
      o.listTotal, o.total, o.status, o.voidReason || "", o.by || ""]),
  ], [11, 5, 7, 14, 40, 8, 14, 10, 10, 18, 10]), "All orders");
  save(wb, `booth-report-week-${todayKey()}.xlsx`);
}
