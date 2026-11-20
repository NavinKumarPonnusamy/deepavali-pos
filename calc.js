// js/v2/admin/calc.js
// Money maths. Pure functions: data in, numbers out.
//
// Sales  = all money taken (free orders = RM0, voids left out)
// Profit = sales − expenses − staff share

import { round2 } from "../../utils.js";

const sum = (list, fn) => list.reduce((s, x) => s + (Number(fn(x)) || 0), 0);
export const EXPENSE_CATS = ["Ingredients", "Packaging", "Booth fee", "Salary", "Equipment", "Printing & deco", "Transport", "Other"];

// Every day that has orders, a closing or an expense, newest first, plus today.
export function allDays(state, today) {
  const set = new Set([today]);
  state.orders.forEach((o) => o.day && set.add(o.day));
  Object.keys(state.days).forEach((d) => set.add(d));
  allExpenses(state).forEach((e) => e.date && set.add(e.date));
  return [...set].sort().reverse();
}

// ---------- One day ----------
export function daySales(state, day) {
  const all = state.orders.filter((o) => o.day === day);
  const valid = all.filter((o) => o.status !== "void");
  const paid = valid.filter((o) => o.pay !== "free");
  const value = (l) => (Number(l.price) || 0) * (Number(l.qty) || 0);
  const sales = round2(sum(paid, (o) => o.total));

  // items sold (paid + free counted in qty, sales from paid only)
  const map = new Map();
  for (const o of valid) {
    for (const l of o.items) {
      const label = l.label ?? l.size ?? "";
      const key = (l.name || "") + "|" + label;
      const row = map.get(key) || { name: l.name, label, qty: 0, freeQty: 0, sales: 0 };
      row.qty += Number(l.qty) || 0;
      if (o.pay === "free") row.freeQty += Number(l.qty) || 0;
      else row.sales += value(l);
      map.set(key, row);
    }
  }
  const items = [...map.values()].map((r) => ({ ...r, sales: round2(r.sales) })).sort((a, b) => b.sales - a.sales || b.qty - a.qty);

  const byHour = {};
  for (const o of paid) {
    const h = new Date(o.createdAt).getHours();
    byHour[h] = byHour[h] || { orders: 0, sales: 0 };
    byHour[h].orders += 1; byHour[h].sales += o.total;
  }
  const hs = Object.keys(byHour).map(Number);
  const hourly = [];
  if (hs.length) for (let h = Math.min(...hs); h <= Math.max(...hs); h++)
    hourly.push({ hour: h, orders: byHour[h]?.orders || 0, sales: round2(byHour[h]?.sales || 0) });

  return {
    day, all, valid, items, hourly,
    orders: valid.length,
    sales,
    avgOrder: paid.length ? round2(sales / paid.length) : 0,
    cash: round2(sum(paid.filter((o) => o.pay === "cash"), (o) => o.total)),
    tng: round2(sum(paid.filter((o) => o.pay === "qr"), (o) => o.total)),
    freeCount: valid.length - paid.length,
    freeValue: round2(sum(valid.filter((o) => o.pay === "free"), (o) => o.listTotal)),
    voidCount: all.length - valid.length,
  };
}

// ---------- Expenses ----------
// Expenses collection + "other costs" typed into the OLD closing screen (read-only here).
export function allExpenses(state) {
  const legacy = [];
  for (const [day, c] of Object.entries(state.days)) {
    (c.extras || []).forEach((x, i) => legacy.push({
      id: `legacy-${day}-${i}`, date: day, what: x.what || "Other cost", amount: Number(x.amount) || 0,
      category: "Other", note: "from old closing screen", source: "legacy",
    }));
    // Days closed on the OLD screen never created salary expenses. Count their hours here.
    // (Once a day is saved on the new Closing screen, its salary is a real expense instead.)
    if (!c.closedAt) {
      const rate = Number(state.settings.hourlyRate) || 0;
      (c.staff || []).filter((p) => p.name && Number(p.hours) > 0).forEach((p, i) => legacy.push({
        id: `legacy-sal-${day}-${i}`, date: day, what: `Salary: ${p.name}, ${p.hours} hrs × RM${rate}`,
        amount: round2(Number(p.hours) * rate), category: "Salary", note: "from old closing screen", source: "legacy",
      }));
    }
  }
  return [...state.expenses, ...legacy]
    .map((e) => ({ ...e, amount: Number(e.amount) || 0 }))
    .sort((a, b) => (b.date || "").localeCompare(a.date || "") || (b.createdAt || 0) - (a.createdAt || 0));
}
export const expensesOn = (state, day) => round2(sum(allExpenses(state).filter((e) => e.date === day), (e) => e.amount));

// ---------- Cash check for a closing ----------
export function cashCheck(ds, closing) {
  if (!closing || closing.countedCash === undefined || closing.countedCash === null || closing.countedCash === "") return null;
  const expected = round2((Number(closing.float) || 0) + ds.cash);
  return { expected, counted: Number(closing.countedCash), diff: round2(Number(closing.countedCash) - expected) };
}

export const isClosed = (c) => !!c && (!!c.closedAt || (c.countedCash !== undefined && c.countedCash !== null));

// ---------- Whole event ----------
export function eventSummary(state, today) {
  const days = allDays(state, today).sort();
  const perDay = days.map((d) => ({ ...daySales(state, d), expenses: expensesOn(state, d), closed: isClosed(state.days[d]) }));
  const sales = round2(sum(perDay, (d) => d.sales));
  const expList = allExpenses(state);
  const expenses = round2(sum(expList, (e) => e.amount));
  const byCat = {};
  expList.forEach((e) => { byCat[e.category || "Other"] = round2((byCat[e.category || "Other"] || 0) + e.amount); });

  // staff = everyone with hours in any closing
  const staffSet = new Set();
  Object.values(state.days).forEach((c) => (c.staff || []).forEach((p) => { if (p.name && Number(p.hours) > 0) staffSet.add(p.name.trim()); }));
  const staff = [...staffSet].sort();
  const pool = round2(sales * (Number(state.settings.sharePct) || 0) / 100);
  const each = staff.length ? round2(pool / staff.length) : 0;

  return {
    perDay: perDay.filter((d) => d.orders || d.expenses || state.days[d.day]),
    sales,
    cash: round2(sum(perDay, (d) => d.cash)), tng: round2(sum(perDay, (d) => d.tng)),
    orders: sum(perDay, (d) => d.orders),
    expenses, byCat, pool, staff, each,
    profit: round2(sales - expenses - pool),
  };
}
