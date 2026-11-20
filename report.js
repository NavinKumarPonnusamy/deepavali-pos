// js/v2/admin/report.js — Excel downloads (SheetJS, loaded in admin2.html).
import { todayKey, timeOf } from "../../utils.js";
import { state } from "./data.js";
import { daySales, allExpenses, eventSummary, cashCheck } from "./calc.js";
import { PAY_LABEL } from "../model.js";

function book(sheets, file) {
  if (!window.XLSX) { alert("The Excel tool didn't load. Check the internet and refresh."); return; }
  const wb = XLSX.utils.book_new();
  for (const [name, rows, widths] of sheets) {
    const ws = XLSX.utils.aoa_to_sheet(rows);
    if (widths) ws["!cols"] = widths.map((w) => ({ wch: w }));
    XLSX.utils.book_append_sheet(wb, ws, name);
  }
  XLSX.writeFile(wb, file);
}

export function dayReport(day) {
  const ds = daySales(state, day);
  const c = state.days[day];
  const chk = cashCheck(ds, c);
  const exp = allExpenses(state).filter((e) => e.date === day);
  book([
    ["Summary", [
      ["Cupcha day report", day], [],
      ["Sales (RM)", ds.sales],
      ["Cash (RM)", ds.cash], ["TNG (RM)", ds.tng],
      ["Orders", ds.orders], ["Free orders", ds.freeCount], ["Voids", ds.voidCount], [],
      ["Float (RM)", c?.float ?? ""], ["Cash counted (RM)", c?.countedCash ?? ""],
      ["Cash expected (RM)", chk ? chk.expected : ""], ["Cash difference (RM)", chk ? chk.diff : ""], [],
      ["Expenses this day (RM)", exp.reduce((s, e) => s + e.amount, 0)],
      ["Note", c?.note || ""],
    ], [26, 16]],
    ["Items", [["Item", "Label", "Qty", "Free qty", "Sales (RM)"],
      ...ds.items.map((r) => [r.name, r.label, r.qty, r.freeQty, r.sales])], [22, 10, 6, 9, 11]],
    ["Orders", [["Time", "Name", "Items", "Payment", "Total (RM)", "Status", "By"],
      ...ds.all.map((o) => [timeOf(o.createdAt), o.name || "", o.items.map((l) => `${l.qty}× ${l.name}`).join(", "),
        PAY_LABEL[o.pay] || o.pay, o.total, o.status === "void" ? "void: " + (o.voidReason || "") : o.status, o.by || ""])], [7, 14, 40, 8, 10, 18, 10]],
    ["Expenses", [["What", "Category", "Amount (RM)", "Note"], ...exp.map((e) => [e.what, e.category, e.amount, e.note || ""])], [36, 14, 12, 24]],
  ], `cupcha-day-${day}.xlsx`);
}

export function eventReport() {
  const ev = eventSummary(state, todayKey());
  const items = new Map();
  ev.perDay.forEach((d) => d.items.forEach((r) => {
    const k = r.name + "|" + r.label;
    const x = items.get(k) || { name: r.name, label: r.label, qty: 0, sales: 0 };
    x.qty += r.qty; x.sales += r.sales; items.set(k, x);
  }));
  book([
    ["Summary", [
      ["Cupcha event report", todayKey()], [],
      ["Sales (RM)", ev.sales],
      ...Object.entries(ev.byCat).map(([c, v]) => ["− " + c, -v]),
      [`− Staff share (${state.settings.sharePct}%)`, -ev.pool],
      ["= Profit (RM)", ev.profit], [],
      ["Cash (RM)", ev.cash], ["TNG (RM)", ev.tng], ["Orders", ev.orders],
    ], [30, 14]],
    ["Days", [["Day", "Orders", "Sales", "Cash", "TNG", "Expenses"],
      ...ev.perDay.map((d) => [d.day, d.orders, d.sales, d.cash, d.tng, d.expenses])], [12, 8, 12, 10, 10, 10]],
    ["Items", [["Item", "Label", "Qty", "Sales (RM)"],
      ...[...items.values()].sort((a, b) => b.sales - a.sales).map((x) => [x.name, x.label, x.qty, Math.round(x.sales * 100) / 100])], [22, 10, 6, 11]],
    ["Expenses", [["Date", "What", "Category", "Amount (RM)", "Note"],
      ...allExpenses(state).map((e) => [e.date, e.what, e.category, e.amount, e.note || ""])], [11, 36, 14, 12, 24]],
    ["Staff share", [["Pool (RM)", ev.pool], ["Split equally between", ev.staff.length], [],
      ["Name", "Share (RM)"], ...ev.staff.map((n) => [n, ev.each])], [22, 12]],
  ], `cupcha-event-${todayKey()}.xlsx`);
}
