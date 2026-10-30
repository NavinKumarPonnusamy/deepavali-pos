// js/cashier.js
// The cashier screen: take orders, see today's totals, move orders along, void mistakes.

import { db } from "./firebase.js";
import { collection, doc, onSnapshot, addDoc, updateDoc, query, where }
  from "https://www.gstatic.com/firebasejs/13.0.0/firebase-firestore.js";
import { startAuth, logout, currentCode, emailToCode } from "./auth-gate.js";
import { rm, round2, todayKey, timeOf, esc, itemsSummary } from "./utils.js";

const $ = (id) => document.getElementById(id);

// ---------- State (everything the screen knows right now) ----------
let menu = { items: [], floorMode: false }; // from menu/main
let orders = [];                             // today's orders, oldest first
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
  $("menuGrid").innerHTML = items.map((item) => `
    <div class="menu-item">
      <div class="menu-name">${esc(item.name)}</div>
      <div class="size-row">
        ${item.sizes.map((s, idx) => `
          <button class="btn size" type="button" data-item="${esc(item.id)}" data-size="${idx}">
            ${s.label ? `<b>${esc(s.label)}</b> ` : ""}${rm(s.price)}
          </button>`).join("")}
      </div>
    </div>`).join("");
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

  const line = cart.find((l) => l.key === key);
  if (line) line.qty += 1;
  else cart.push({
    key,
    itemId,
    name: item.name,
    size: size.label,
    price: size.price,
    cost: size.cost,           // copied so old orders keep the cost they had
    qty: 1,
    instant: !!item.instant,
    friendItem: !!item.friendItem,
  });
  $("orderMsg").textContent = "";
  renderCart();
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
  updateChange();
  updateChargeButton();
}

$("cartList").addEventListener("click", (e) => {
  const inc = e.target.closest("[data-inc]");
  const dec = e.target.closest("[data-dec]");
  if (inc) cart[Number(inc.dataset.inc)].qty += 1;
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

  // We do NOT wait (no "await") for the server here. Firestore shows the new
  // order on this screen immediately and sends it as soon as it can, so a
  // short Wi-Fi drop doesn't freeze the queue. Errors still get reported.
  addDoc(collection(db, "orders"), order).catch(showError);

  $("orderMsg").textContent = `Order #${no} saved${allInstant ? " (hand over now)" : " (sent to kitchen)"}.`;
  clearOrder();
});

// ---------- Today panel ----------
function renderSide() {
  renderStats();
  renderActive();
  renderRecent();
}

function renderStats() {
  const valid = orders.filter((o) => o.status !== "void");
  const sum = (list) => round2(list.reduce((s, o) => s + o.total, 0));
  const cash = valid.filter((o) => o.pay === "cash");
  const qr = valid.filter((o) => o.pay === "qr");
  const free = valid.filter((o) => o.pay === "free");
  const itemsSold = valid.reduce((s, o) => s + o.items.reduce((t, i) => t + i.qty, 0), 0);

  $("stats").innerHTML = `
    <div class="stat"><span>Sales</span><b>${rm(sum(valid))}</b></div>
    <div class="stat"><span>Orders</span><b>${valid.length}</b></div>
    <div class="stat"><span>Cash</span><b>${rm(sum(cash))}</b></div>
    <div class="stat"><span>QR</span><b>${rm(sum(qr))}</b></div>
    <div class="stat"><span>Items</span><b>${itemsSold}</b></div>
    <div class="stat"><span>Free</span><b>${free.length}</b></div>`;
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
  if (ready) updateDoc(doc(db, "orders", ready.dataset.ready),
    { status: "ready", readyAt: Date.now() }).catch(showError);
  if (collect) updateDoc(doc(db, "orders", collect.dataset.collect),
    { status: "collected", collectedAt: Date.now() }).catch(showError);
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
    updateDoc(doc(db, "orders", confirm.dataset.voidConfirm), {
      status: "void",
      voidReason: $("voidReason").value,
      voidedAt: Date.now(),
      voidedBy: currentCode(),                  // who voided it
    }).catch(showError);
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
