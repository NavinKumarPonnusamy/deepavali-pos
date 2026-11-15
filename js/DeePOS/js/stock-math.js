// js/stock-math.js
// Stock calculations shared by the cashier, menu and stock pages.
//
// inv = { [inventoryId]: { name, unit, onHand, baseline, avgCost, lowAt } }
//   onHand   = estimated amount left right now (ml, pcs or g)
//   baseline = the amount at the last opening count or top-up ("full" on the bar)
//   avgCost  = RM per unit (per ml, per piece, per gram)
//
// A menu size can have a recipe: [{ inv: "<inventoryId>", amount: 15 }, ...]
// meaning "one of these uses 15 ml of that ingredient".

const hasRecipe = (size) => Array.isArray(size.recipe) && size.recipe.length > 0;

// How many of this size can still be made, limited by whatever runs out first.
// Sizes without a recipe aren't tracked: Infinity.
export function servingsLeft(size, inv, field = "onHand") {
  if (!hasRecipe(size)) return Infinity;
  let min = Infinity;
  for (const part of size.recipe) {
    const stock = inv[part.inv];
    if (!stock || !(part.amount > 0)) continue;           // deleted ingredient or blank row: ignore
    const possible = Math.floor(Math.max(0, stock[field] || 0) / part.amount);
    min = Math.min(min, possible);
  }
  return min;
}

// Level of a whole menu item, for the bar on its card.
// The bar follows the LOWEST size, because its job is to say "something needs topping up".
// Returns { tracked, pct (0 to 1), soldOut (every size out), sizeOut: [true/false per size] }
export function itemLevel(item, inv) {
  let tracked = false, lowest = 1;
  const sizeOut = item.sizes.map((size) => {
    const left = servingsLeft(size, inv);
    if (left === Infinity) return false;                  // untracked size: always available
    tracked = true;
    const full = servingsLeft(size, inv, "baseline");
    const pct = full > 0 ? Math.min(1, left / full) : (left > 0 ? 1 : 0);
    lowest = Math.min(lowest, pct);
    return left <= 0;
  });
  return { tracked, pct: tracked ? lowest : 1, soldOut: sizeOut.every(Boolean), sizeOut };
}

// Cost of one serving: from the recipe if it has one, otherwise the typed-in cost.
export function sizeCost(size, inv) {
  if (!hasRecipe(size)) return Number(size.cost) || 0;
  return size.recipe.reduce((sum, part) => {
    const stock = inv[part.inv];
    return sum + (stock ? (Number(part.amount) || 0) * (stock.avgCost || 0) : 0);
  }, 0);
}

// Total amount of each ingredient a list of order lines needs.
// lines: [{ recipe: [...], qty }]  ->  { inventoryId: totalAmount }
export function usageOf(lines) {
  const use = {};
  for (const line of lines) {
    for (const part of line.recipe || []) {
      if (!(part.amount > 0)) continue;
      use[part.inv] = (use[part.inv] || 0) + part.amount * line.qty;
    }
  }
  return use;
}

// "1,250 ml", "36 pcs"
export function fmtQty(n, unit) {
  const v = Math.round((Number(n) || 0) * 10) / 10;
  return v.toLocaleString("en-MY") + " " + (unit || "");
}
