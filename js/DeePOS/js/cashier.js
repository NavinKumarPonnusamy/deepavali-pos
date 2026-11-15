// js/cashier.js
// The cashier screen: take orders, see today's totals, move orders along, void mistakes.

import { db } from "./firebase.js";
import { collection, doc, onSnapshot, query, where, writeBatch, increment }
  from "https://www.gstatic.com/firebasejs/13.0.0/firebase-firestore.js";
import { startAuth, logout, currentCode, emailToCode } from "./auth-gate.js";
import { rm, round2, todayKey, timeOf, esc, itemsSummary } from "./utils.js";
import { servingsLeft, itemLevel, sizeCost, usageOf } from "./stock-math.js";

const $ = (id) => document.getElementById(id);

// ---------- State (everything the screen knows right now) ----------
let menu = { items: [], floorMode: false }; // from menu/main
let orders = [];                             // today's orders, oldest first
let inv = {};                                // stock levels: { inventoryId: {...} }
let cart = [];                               // lines in the current order
let pay = "cash";                            // "cash" | "qr" | "free"
let voidingId = null;                        // which recent order shows the void form
let day = todayKey();
let unsubs = [];                             // live listeners, so we can stop them on sign-out

// ---------- Start ----------
startAuth({
  onSignedIn: (user) => {
    $("who").textContent = emailToCode(user.email);
    listen();
  },
  onSignedOut: stopListening,
});
$("logoutBtn").addEventListener("click", logout);

// ---------- Live data from Firestore ----------
function listen() {
  stopListening();

  // Menu: re-renders the buttons whenever the menu changes (e.g. Pani Puri switched on)
  unsubs.push(onSnapshot(doc(db, "menu", "main"), (snap) => {
    menu = snap.exists() ? snap.data() : { items: [], floorMode: false };
    renderMenu();
    renderSide();
  }, showError));

  // Today's orders only. A single "where" filter needs no special index.
  const q = query(collection(db, "orders"), where("day", "==", day));
  unsubs.push(onSnapshot(q, (snap) => {
    orders = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    orders.sort((a, b) => a.createdAt - b.createdAt);
    renderSide();
    $("nextNo").textContent = "#" + nextNumber();
  }, showError));

  // Stock levels: drives the bars and sold-out on the menu cards.
  unsubs.push(onSnapshot(collection(db, "inventory"), (snap) => {
    inv = {};
    snap.docs.forEach((d) => { inv[d.id] = d.data(); });
    renderMenu();
  }, showError));
}

function stopListening() {
  unsubs.forEach((stop) => stop());
  unsubs = [];
}

// ---------- Menu ----------
function renderMenu() {
  const items = (menu.items || []).filter((i) => i.active);
  if (!items.length) {
    $("menuGrid").innerHTML = `<p class="muted">No items are switched on. Turn items on in the menu settings.</p>`;
    return;
  }
  $("menuGrid").innerHTML = items.map((item) => {
    const lvl = itemLevel(item, inv);
    const pct = Math.round(lvl.pct * 100);
    // green above 50%, amber 20-50%, red below 20%
    const tone = pct > 50 ? "ok" : pct >= 20 ? "warn" : "low";
    return `
    <div class="menu-item ${lvl.soldOut ? "sold-out" : ""}">
      <div class="menu-name">${esc(item.name)}${lvl.soldOut ? ` <span class="sold-tag">SOLD OUT</span>` : ""}</div>
      <div class="size-row">
        ${item.sizes.map((s, idx) => `
          <button class="btn size" type="button" data-item="${esc(item.id)}" data-size="${idx}"
                  ${lvl.sizeOut[idx] ? "disabled" : ""}>
            ${s.label ? `<b>${esc(s.label)}</b> ` : ""}${lvl.sizeOut[idx] ? "Sold out" : rm(s.price)}
          </button>`).join("")}
      </div>
      ${lvl.tracked ? `
        <div class="stock-bar" role="meter" aria-label="${esc(item.name)} stock" aria-valuenow="${pct}" aria-valuemin="0" aria-valuemax="100">
          <span class="stock-fill ${tone}" style="width:${pct}%"></span>
        </div>
        <div class="stock-text ${tone}">${stockText(item, lvl, pct)}</div>` : ""}
    </div>`;
  }).join("");
}

// "68% left", "L sold out · tell an admin", "Tell an admin to top up"
function stockText(item, lvl, pct) {
  if (lvl.soldOut) return "Tell an admin to top up";
  const out = item.sizes.filter((s, i) => lvl.sizeOut[i]).map((s) => s.label || "One size");
  if (out.length) return `${out.join(", ")} sold out · tell an admin`;
  return pct < 20 ? `${pct}% left · tell an admin` : `${pct}% left`;
}

// One click listener for the whole grid ("event delegation"),
// instead of one listener per button. Works even after re-rendering.
$("menuGrid").addEventListener("click", (e) => {
  const btn = e.target.closest("button[data-item]");
  if (!btn) return;
  addToCart(btn.dataset.item, Number(btn.dataset.size));
});

// ---------- Cart ----------
function addToCart(itemId, sizeIdx) {
  const item = menu.items.find((i) => i.id === itemId);
  if (!item) return;
  const size = item.sizes[sizeIdx];
  const key = itemId + "|" + size.label;

  if (!hasStockFor(size)) {
    flash(`Not enough stock for another ${item.name}${size.label ? " " + size.label : ""}. Tell an admin.`);
    return;
  }

  const line = cart.find((l) => l.key === key);
  if (line) line.qty += 1;
  else cart.push({
    key,
    itemId,
    name: item.name,
    size: size.label,
    price: size.price,
    cost: Math.round(sizeCost(size, inv) * 10000) / 10000,  // cost of ONE, copied so old orders keep it
    recipe: size.recipe || [],                       // copied so a void can put the stock back
    qty: 1,
    instant: !!item.instant,
    friendItem: !!item.friendItem,
  });
  $("orderMsg").textContent = "";
  renderCart();
}

// Would the stock still cover everything in the cart PLUS one more of this size?
function hasStockFor(size) {
  const need = usageOf([...cart, { recipe: size.recipe || [], qty: 1 }]);
  return Object.entries(need).every(([id, amount]) => !inv[id] || inv[id].onHand >= amount);
}

function cartTotal() {
  return round2(cart.reduce((sum, l) => sum + l.price * l.qty, 0));
}

function renderCart() {
  $("cartList").innerHTML = cart.length
    ? cart.map((l, i) => `
        <li class="cart-line">
          <span class="cart-name">${esc(l.name)}${l.size ? ` <b>${esc(l.size)}</b>` : ""}</span>
          <span class="qty">
            <button class="btn small" type="button" data-dec="${i}" aria-label="One less">−</button>
            <span>${l.qty}</span>
            <button class="btn small" type="button" data-inc="${i}" aria-label="One more">+</button>
          </span>
          <span class="cart-sum">${rm(l.price * l.qty)}</span>
        </li>`).join("")
    : `<li class="muted">Tap items on the menu to add them.</li>`;

  $("cartTotal").textContent = rm(cartTotal());
  if ($("qrAmount")) $("qrAmount").textContent = rm(cartTotal());   // amount shown next to the QR
  updateChange();
  updateChargeButton();
}

$("cartList").addEventListener("click", (e) => {
  const inc = e.target.closest("[data-inc]");
  const dec = e.target.closest("[data-dec]");
  if (inc) {
    const line = cart[Number(inc.dataset.inc)];
    if (hasStockFor({ recipe: line.recipe })) line.qty += 1;
    else flash(`Not enough stock for another ${line.name}. Tell an admin.`);
  }
  if (dec) {
    const i = Number(dec.dataset.dec);
    cart[i].qty -= 1;
    if (cart[i].qty <= 0) cart.splice(i, 1);
  }
  renderCart();
});

function clearOrder() {
  cart = [];
  $("custName").value = "";
  $("received").value = "";
  setPay("cash");
  renderCart();
}
$("clearBtn").addEventListener("click", clearOrder);

// ---------- Payment ----------
function setPay(method) {
  pay = method;
  document.querySelectorAll("[data-pay]").forEach((b) =>
    b.classList.toggle("active", b.dataset.pay === method));
  $("cashBox").hidden = method !== "cash";
  $("qrBox").hidden = method !== "qr";
  $("freeBox").hidden = method !== "free";
  updateChargeButton();
}
document.querySelector(".pay-toggle").addEventListener("click", (e) => {
  const b = e.target.closest("[data-pay]");
  if (b) setPay(b.dataset.pay);
});

document.querySelector(".quick-cash").addEventListener("click", (e) => {
  const b = e.target.closest("[data-cash]");
  if (!b) return;
  $("received").value = b.dataset.cash;
  updateChange();
});
$("received").addEventListener("input", updateChange);

function updateChange() {
  const received = parseFloat($("received").value);
  const total = cartTotal();
  if (!received || !cart.length) { $("change").textContent = "–"; return; }
  const diff = round2(received - total);
  $("change").textContent = diff >= 0 ? rm(diff) : "Short by " + rm(-diff);
}

function updateChargeButton() {
  const btn = $("chargeBtn");
  btn.disabled = cart.length === 0;
  btn.textContent = pay === "free"
    ? "Record free order"
    : `Charge ${rm(cartTotal())} (${pay === "cash" ? "cash" : "QR"})`;
}

// ---------- Save the order ----------
// Order numbers restart at 1 each day. We take the highest number among today's
// orders (including ones still being saved) and add 1. Only ONE cashier device
// should take orders, or two devices could hand out the same number.
function nextNumber() {
  return orders.reduce((max, o) => Math.max(max, o.no || 0), 0) + 1;
}

$("chargeBtn").addEventListener("click", () => {
  if (!cart.length) return;

  // If the laptop stayed open past midnight, switch to the new day first.
  if (todayKey() !== day) { day = todayKey(); orders = []; listen(); }

  const now = Date.now();
  const items = cart.map(({ key, ...line }) => line); // drop the internal "key"
  const listTotal = cartTotal();
  const allInstant = items.every((i) => i.instant);
  const no = nextNumber();

  const order = {
    no,
    day,
    name: $("custName").value.trim(),
    items,
    listTotal,                                  // menu value of the items
    total: pay === "free" ? 0 : listTotal,      // money actually received
    pay,
    freeReason: pay === "free" ? $("freeReason").value : null,
    // Chai / rusk / murukku only: handed over on the spot, skip the kitchen
    status: allInstant ? "collected" : "preparing",
    createdAt: now,
    readyAt: allInstant ? now : null,
    collectedAt: allInstant ? now : null,
    voidReason: null,
    by: currentCode(),                          // who took the order, e.g. "kavin"
  };

  // One "batch" = the order AND the stock deductions are saved together, all or nothing.
  // increment(-15) subtracts 15 on the server, so two devices selling at once can't
  // overwrite each other's numbers.
  const batch = writeBatch(db);
  batch.set(doc(collection(db, "orders")), order);
  changeStock(batch, usageOf(items), -1);

  // We do NOT wait (no "await") for the server here. Firestore shows the new
  // order on this screen immediately and sends it as soon as it can, so a
  // short Wi-Fi drop doesn't freeze the queue. Errors still get reported.
  batch.commit().catch(showError);

  flash(`Order #${no} saved${allInstant ? " (hand over now)" : " (sent to kitchen)"}.`);
  clearOrder();
});

// Add (+1) or subtract (-1) amounts from stock, inside a batch.
// Skips ingredients that no longer exist, so a deleted ingredient can't block a sale.
function changeStock(batch, use, sign) {
  for (const [id, amount] of Object.entries(use)) {
    if (inv[id]) batch.update(doc(db, "inventory", id), { onHand: increment(sign * amount) });
  }
}

// Show a message under the Charge button, then clear it after 3 seconds.
// clearTimeout cancels the previous timer, so a new message never gets wiped early.
let flashTimer = null;
function flash(text) {
  $("orderMsg").textContent = text;
  clearTimeout(flashTimer);
  flashTimer = setTimeout(() => { $("orderMsg").textContent = ""; }, 3000);
}

// ---------- Today panel ----------
// (Sales totals are admin-only now: they live on the admin dashboard, not here.)
function renderSide() {
  renderActive();
  renderRecent();
}

// Orders still being made or waiting to be picked up.
// Until the kitchen screen exists, the cashier moves them along from here.
function renderActive() {
  const active = orders.filter((o) => o.status === "preparing" || o.status === "ready");
  $("activeList").innerHTML = active.length
    ? active.map((o) => {
        let action = "";
        if (o.status === "preparing") {
          action = `<button class="btn small" type="button" data-ready="${o.id}">Mark ready</button>`;
        } else if (!menu.floorMode) {
          action = `<button class="btn small primary" type="button" data-collect="${o.id}">Collected</button>`;
        } else {
          action = `<span class="muted">With floor</span>`;
        }
        return `
          <li class="order-row status-${o.status}">
            <div><b>#${o.no}</b> ${esc(o.name)} <span class="pill">${o.status}</span></div>
            <div class="muted">${esc(itemsSummary(o.items))}</div>
            <div>${action}</div>
          </li>`;
      }).join("")
    : `<li class="muted">Nothing in progress.</li>`;
}

$("activeList").addEventListener("click", (e) => {
  const ready = e.target.closest("[data-ready]");
  const collect = e.target.closest("[data-collect]");
  const save = (id, fields) => {
    const batch = writeBatch(db);
    batch.update(doc(db, "orders", id), fields);
    batch.commit().catch(showError);
  };
  if (ready) save(ready.dataset.ready, { status: "ready", readyAt: Date.now() });
  if (collect) save(collect.dataset.collect, { status: "collected", collectedAt: Date.now() });
});

// Last 10 orders, newest first, with a Void option.
function renderRecent() {
  const recent = [...orders].reverse().slice(0, 10);
  $("recentList").innerHTML = recent.length
    ? recent.map((o) => {
        const isVoid = o.status === "void";
        const voidForm = voidingId === o.id ? `
          <div class="void-form">
            <select id="voidReason">
              <option>Wrong item entered</option>
              <option>Customer cancelled</option>
              <option>Entered twice</option>
              <option>Test order</option>
              <option>Other</option>
            </select>
            <button class="btn small danger" type="button" data-void-confirm="${o.id}">Void order</button>
            <button class="btn small ghost" type="button" data-void-cancel>Keep</button>
          </div>` : "";
        return `
          <li class="order-row ${isVoid ? "is-void" : ""}">
            <div>
              <b>#${o.no}</b> ${esc(o.name)}
              <span class="muted">${timeOf(o.createdAt)}</span>
              <span class="pill">${o.pay}</span>
              ${isVoid ? `<span class="pill danger">void: ${esc(o.voidReason)}</span>` : ""}
            </div>
            <div class="muted">${esc(itemsSummary(o.items))} · <b>${rm(o.total)}</b></div>
            ${!isVoid && voidingId !== o.id ? `<button class="btn small ghost" type="button" data-void="${o.id}">Void</button>` : ""}
            ${voidForm}
          </li>`;
      }).join("")
    : `<li class="muted">No orders yet today.</li>`;
}

$("recentList").addEventListener("click", (e) => {
  const start = e.target.closest("[data-void]");
  const confirm = e.target.closest("[data-void-confirm]");
  const cancel = e.target.closest("[data-void-cancel]");

  if (start) { voidingId = start.dataset.void; renderRecent(); }
  if (cancel) { voidingId = null; renderRecent(); }
  if (confirm) {
    // A void never deletes the order. It stays in the records, marked void,
    // so the owner can see every cancellation and its reason.
    // The stock the order used goes back, in the same batch as the void.
    const order = orders.find((o) => o.id === confirm.dataset.voidConfirm);
    const batch = writeBatch(db);
    batch.update(doc(db, "orders", order.id), {
      status: "void",
      voidReason: $("voidReason").value,
      voidedAt: Date.now(),
      voidedBy: currentCode(),                  // who voided it
    });
    changeStock(batch, usageOf(order.items), +1);
    batch.commit().catch(showError);
    voidingId = null;
  }
});

// ---------- Errors ----------
function showError(err) {
  console.error(err);
  $("orderMsg").textContent = "Something went wrong: " + (err.code || err.message) +
    ". Check the internet connection and try again.";
}

renderCart();
