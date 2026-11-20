// js/v2/model.js
// The menu, the way the new screens see it.
//
// New item:  { id, name, label, price, category, active, instant, pieces?, picks? }
//   label   = small text under the name, e.g. "16oz", "6oz", "6 pcs"
//   instant = hand over at the counter (never goes to the kitchen)
//   pieces  = { full: 6, perPiece: 1 } → cashier asks "how many pcs?" (pani puri)
//   picks   = ["Drinks", "Dessert"]   → combo: cashier picks 1 item from each category
//
// Older items had a list of sizes (R / L) with recipes. expandItems() turns each
// size into its own item, so old menus still show up correctly.
// toSaved() also writes a one-size "sizes" list, so the OLD cashier page keeps
// working as a backup with the new menu.

export const CATEGORIES = ["Drinks", "Food", "Dessert", "Combo", "Other"];

export function expandItems(items = []) {
  const out = [];
  for (const it of items) {
    if (typeof it.price === "number") {          // already the new shape
      out.push(normal(it, it.id, it.label ?? "", it.price));
      continue;
    }
    const sizes = it.sizes && it.sizes.length ? it.sizes : [{ label: "", price: 0 }];
    sizes.forEach((s, j) => {
      out.push(normal(it, j === 0 ? it.id : `${it.id}-${j}`, s.label || "", Number(s.price) || 0));
    });
  }
  return out;
}

function normal(it, id, label, price) {
  return {
    id,
    name: it.name || "",
    label,
    price,
    category: CATEGORIES.includes(it.category) ? it.category : guessCategory(it),
    active: it.active !== false,
    instant: !!it.instant,
    pieces: it.pieces && Number(it.pieces.full) > 0 ? { full: Number(it.pieces.full), perPiece: Number(it.pieces.perPiece) || 0 } : null,
    picks: Array.isArray(it.picks) ? it.picks.filter((c) => CATEGORIES.includes(c)) : [],
  };
}

// Which station makes it: "drinks", "snacks" or "counter" (handed over by the cashier).
export function stationOf(item) {
  if (item.instant) return "counter";
  if (item.category === "Drinks") return "drinks";
  if (item.category === "Food") return "snacks";
  return "counter";
}
export const STATIONS = { drinks: "Drinks", snacks: "Snacks" };

// Old items had no category. Drinks are the safe guess, except obvious food.
function guessCategory(it) {
  const n = (it.name || "").toLowerCase();
  if (/puri|murukku|samosa|vadai/.test(n)) return "Food";
  if (/tart|brownie|cake|popsicle|aiskrim|ice ?cream/.test(n)) return "Dessert";
  if (/combo|\+/.test(n)) return "Combo";
  return "Drinks";
}

export function toSaved(it) {
  return {
    id: it.id,
    name: it.name.trim(),
    label: it.label.trim(),
    price: Number(it.price) || 0,
    category: it.category,
    active: !!it.active,
    friendItem: false,   // no more friend's items: everything is shared
    instant: !!it.instant,
    pieces: it.pieces ? { full: Number(it.pieces.full) || 0, perPiece: Number(it.pieces.perPiece) || 0 } : null,
    picks: it.category === "Combo" ? (it.picks || []) : [],
    // for the old cashier page (backup): one size, no recipe
    sizes: [{ label: it.label.trim(), price: Number(it.price) || 0, cost: 0, recipe: [] }],
  };
}

export const newId = () => "i" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);

// What a payment method is called on screen. Stored values stay "cash" / "qr" / "free"
// so older orders and the security rules don't need to change.
export const PAY_LABEL = { cash: "Cash", qr: "TNG", free: "Free" };
