// js/admin/calc.js
// All the money and stock maths for the dashboard and the Excel report.
// Pure functions: data in, numbers out. Nothing here touches the screen or the database.

import { round2 } from "../utils.js";
import { usageOf, servingsLeft } from "../stock-math.js";

const sum = (list, fn) => list.reduce((s, x) => s + (fn(x) || 0), 0);
const lineValue = (l) => l.price * l.qty;
const lineCost = (l) => (l.cost || 0) * l.qty;

// Every date that has orders, purchases or a closing, newest first, plus today.
export function allDays(state, today) {
  const set = new Set([today]);
  state.orders.forEach((o) => set.add(o.day));
  state.purchases.forEach((p) => set.add(p.day));
  Object.keys(state.days).forEach((d) => set.add(d));
  return [...set].sort().reverse();
}

// ---------- One day's sales ----------
export function daySales(state, day) {
  const all = state.orders.filter((o) => o.day === day);
  const valid = all.filter((o) => o.status !== "void");
  const voids = all.filter((o) => o.status === "void");
  const lines = valid.flatMap((o) => o.items.map((l) => ({ ...l, pay: o.pay })));
  const paidLines = lines.filter((l) => l.pay !== "free");

  const sales = round2(sum(valid, (o) => o.total));
  const friendSales = round2(sum(paidLines.filter((l) => l.friendItem), lineValue));
  const boothSales = round2(sales - friendSales);

  // Items sold, one row per item + size
  const map = new Map();
  for (const l of lines) {
    const key = l.itemId + "|" + l.size;
    const row = map.get(key) || {
      name: l.name, size: l.size, price: l.price, friendItem: !!l.friendItem,
      qty: 0, paidQty: 0, freeQty: 0, sales: 0, cost: 0,
    };
    row.qty += l.qty;
    if (l.pay === "free") row.freeQty += l.qty; else { row.paidQty += l.qty; row.sales += lineValue(l); }
    row.cost += lineCost(l);
    map.set(key, row);
  }
  const items = [...map.values()].map((r) => ({ ...r, sales: round2(r.sales), cost: round2(r.cost) }))
    .sort((a, b) => b.sales - a.sales);

  // Sales by hour (only hours that had orders, plus the gaps between them)
  const byHour = {};
  for (const o of valid) {
    const h = new Date(o.createdAt).getHours();
    byHour[h] = byHour[h] || { orders: 0, sales: 0 };
    byHour[h].orders += 1;
    byHour[h].sales += o.total;
  }
  const hours = Object.keys(byHour).map(Number);
  const hourly = [];
  if (hours.length) {
    for (let h = Math.min(...hours); h <= Math.max(...hours); h++) {
      hourly.push({ hour: h, orders: byHour[h]?.orders || 0, sales: round2(byHour[h]?.sales || 0) });
    }
  }

  return {
    day, all, valid, voids, items, hourly,
    orders: valid.length,
    sales, boothSales, friendSales,
    cash: round2(sum(valid.filter((o) => o.pay === "cash"), (o) => o.total)),
    qr: round2(sum(valid.filter((o) => o.pay === "qr"), (o) => o.total)),
    freeCount: valid.filter((o) => o.pay === "free").length,
    freeValue: round2(sum(valid.filter((o) => o.pay === "free"), (o) => o.listTotal)),
    voidCount: voids.length,
    voidValue: round2(sum(voids, (o) => o.listTotal)),
    // Stock used by the booth's own items (murukku is the friend's stock, so it's left out)
    stockUsed: round2(sum(lines.filter((l) => !l.friendItem), lineCost)),
    avgOrder: valid.length ? round2(sales / valid.filter((o) => o.pay !== "free").length || 0) : 0,
  };
}

// ---------- Salary ----------
// Each person: hours × rate. Plus a share pool = sharePct% of booth sales (murukku excluded),
// split equally among people who worked, or in proportion to hours.
export function salary(ds, closing, settings) {
  const people = (closing?.staff || []).filter((p) => p.name && p.hours > 0);
  const pool = round2(ds.boothSales * (settings.sharePct / 100));
  const totalHours = sum(people, (p) => p.hours);
  const rows = people.map((p) => {
    const base = round2(p.hours * settings.hourlyRate);
    const share = round2(settings.shareSplit === "hours"
      ? (totalHours ? pool * (p.hours / totalHours) : 0)
      : pool / people.length);
    return { name: p.name, hours: p.hours, base, share, total: round2(base + share) };
  });
  return { rows, pool, total: round2(sum(rows, (r) => r.total)) };
}

// ---------- Cash ----------
export function cashCheck(ds, closing) {
  if (!closing || closing.countedCash === undefined || closing.countedCash === null) return null;
  const expected = round2((closing.float || 0) + ds.cash);
  const diff = round2(closing.countedCash - expected);
  return { float: closing.float || 0, cashSales: ds.cash, expected, counted: closing.countedCash, diff };
}

// ---------- Profit ----------
// sales − murukku (all of it goes to the friend) − stock used − salary − booth fee
// The booth fee for a day: whatever was saved at closing, otherwise the setting
// (the event day has its own fee).
export const boothFeeFor = (day, settings) =>
  day === settings.eventDay ? settings.eventBoothFee : settings.boothFee;

export function profit(ds, sal, settings, closing) {
  const boothFee = closing?.boothFee ?? boothFeeFor(ds.day, settings);
  return {
    sales: ds.sales,
    friendSales: ds.friendSales,
    stockUsed: ds.stockUsed,
    salary: sal.total,
    boothFee,
    profit: round2(ds.sales - ds.friendSales - ds.stockUsed - sal.total - boothFee),
  };
}

// ---------- Stock movement for one day ----------
export function stockDay(state, day) {
  const counts = state.counts[day] || {};
  const used = usageOf(state.orders.filter((o) => o.day === day && o.status !== "void").flatMap((o) => o.items));
  const bought = {};
  state.purchases.filter((p) => p.day === day).forEach((p) => {
    bought[p.invId] = bought[p.invId] || { qty: 0, price: 0 };
    bought[p.invId].qty += p.qty;
    bought[p.invId].price += p.price;
  });
  const ids = new Set([...Object.keys(state.inv), ...Object.keys(used), ...Object.keys(bought),
    ...Object.keys(counts.opening || {}), ...Object.keys(counts.closing || {})]);
  return [...ids].map((id) => {
    const it = state.inv[id] || counts.closing?.[id] || counts.opening?.[id] || { name: "(deleted item)", unit: "" };
    const close = counts.closing?.[id];
    const avgCost = state.inv[id]?.avgCost ?? close?.avgCost ?? 0;
    const missing = close ? close.estimated - close.counted : null;
    return {
      name: it.name, unit: it.unit,
      opening: counts.opening?.[id]?.counted ?? null,
      boughtQty: bought[id]?.qty || 0,
      boughtRM: round2(bought[id]?.price || 0),
      used: Math.round((used[id] || 0) * 10) / 10,
      usedRM: round2((used[id] || 0) * avgCost),
      expected: close ? close.estimated : null,
      counted: close ? close.counted : null,
      missing: missing !== null && missing > 0 ? Math.round(missing * 10) / 10 : 0,
      missingRM: missing !== null && missing > 0 ? round2(missing * (close.avgCost || avgCost)) : 0,
    };
  }).sort((a, b) => a.name.localeCompare(b.name));
}

// ---------- How long stock lasts ----------
// Usual pace = average amount used per booth day on PAST days (days with sales).
// Today's pace = amount used today ÷ hours since the first order today.
export function stockLasts(state, today) {
  const valid = state.orders.filter((o) => o.status !== "void");
  const pastDays = [...new Set(valid.filter((o) => o.day < today).map((o) => o.day))];
  const pastUse = usageOf(valid.filter((o) => o.day < today).flatMap((o) => o.items));
  const todayOrders = valid.filter((o) => o.day === today);
  const todayUse = usageOf(todayOrders.flatMap((o) => o.items));
  const firstToday = todayOrders.length ? Math.min(...todayOrders.map((o) => o.createdAt)) : null;
  const hoursToday = firstToday ? Math.max(0.5, (Date.now() - firstToday) / 3600000) : 0;

  return Object.entries(state.inv).map(([id, it]) => {
    const perDay = pastDays.length ? (pastUse[id] || 0) / pastDays.length : null;
    const perHour = hoursToday && todayUse[id] ? todayUse[id] / hoursToday : null;
    const left = Math.max(0, it.onHand);
    return {
      id, name: it.name, unit: it.unit, left,
      usedToday: Math.round((todayUse[id] || 0) * 10) / 10,
      perDay: perDay !== null ? Math.round(perDay * 10) / 10 : null,
      daysLeft: perDay ? left / perDay : null,
      hoursLeft: perHour ? left / perHour : null,
      low: it.onHand <= 0 || (it.lowAt > 0 && it.onHand <= it.lowAt),
    };
  }).sort((a, b) => (a.daysLeft ?? a.hoursLeft ?? Infinity) - (b.daysLeft ?? b.hoursLeft ?? Infinity));
}

// "Can still make": servings left for every tracked menu size
export function canMake(state) {
  const rows = [];
  for (const item of state.menu.items || []) {
    item.sizes.forEach((s) => {
      const n = servingsLeft(s, state.inv);
      if (n !== Infinity) rows.push({ name: item.name, size: s.label, n, active: item.active });
    });
  }
  return rows.sort((a, b) => a.n - b.n);
}
