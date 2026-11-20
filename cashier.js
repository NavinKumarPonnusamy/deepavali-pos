// js/v2/cashier.js
// Cupcha cashier: tap items, take the name, Cash or TNG, Charge.
// Orders wait in "To serve" until someone taps Done.
// Staff can mark an item sold out (and back in stock) right from its tile.

import { db } from "../firebase.js";
import { collection, doc, onSnapshot, query, where, writeBatch, setDoc }
  from "https://www.gstatic.com/firebasejs/13.0.0/firebase-firestore.js";
import { startAuth, logout, currentCode, emailToCode } from "../auth-gate.js";
import { rm, round2, todayKey, timeOf, esc } from "../utils.js";
import { expandItems, CATEGORIES, PAY_LABEL, stationOf } from "./model.js";

const $ = (id) => document.getElementById(id);

// ---------- State ----------
let items = [];          // menu items (new shape), shown ones only
let soldOut = {};        // { itemId: { soldOut, by, at } }
let orders = [];         // today's orders, oldest first
let cart = [];           // [{ key, itemId, name, label, price, qty, category, station, parts?, pcs?, priceEdited? }]
let pay = "cash";
let cat = "All";
let tileMenu = null;     // item id whose "sold out?" question is open
let voidingId = null;
let day = todayKey();
let unsubs = [];

startAuth({
  onSignedIn: (user) => { $("who").textContent = emailToCode(user.email); listen(); },
  onSignedOut: stop,
});
$("logoutBtn").addEventListener("click", logout);

// ---------- Live data ----------
function listen() {
  stop();
  unsubs.push(onSnapshot(doc(db, "menu", "main"), (snap) => {
    const all = expandItems(snap.exists() ? snap.data().items : []);
    items = all.filter((i) => i.active);
    renderTabs(); renderTiles(); renderCart();
  }, showError));

  unsubs.push(onSnapshot(collection(db, "soldout"), (snap) => {
    soldOut = {};
    snap.docs.forEach((d) => { soldOut[d.id] = d.data(); });
    renderTiles(); renderCart();
  }, () => { /* rules not updated yet: sold-out switch just stays off */ }));

  const q = query(collection(db, "orders"), where("day", "==", day));
  unsubs.push(onSnapshot(q, (snap) => {
    orders = snap.docs.map((d) => ({ id: d.id, ...d.data() })).sort((a, b) => a.createdAt - b.createdAt);
    renderQueue(); renderRecent();
  }, showError));
}
function stop() { unsubs.forEach((u) => u()); unsubs = []; }

const isOut = (id) => !!soldOut[id]?.soldOut;

// ---------- Category tabs ----------
function renderTabs() {
  const used = CATEGORIES.filter((c) => items.some((i) => i.category === c));
  if (cat !== "All" && !used.includes(cat)) cat = "All";
  $("catTabs").innerHTML = ["All", ...used].map((c) =>
    `<button class="cat ${c === cat ? "active" : ""}" role="tab" aria-selected="${c === cat}" type="button" data-cat="${c}">${c}</button>`
  ).join("");
}
$("catTabs").addEventListener("click", (e) => {
  const b = e.target.closest("[data-cat]");
  if (!b) return;
  cat = b.dataset.cat; tileMenu = null;
  renderTabs(); renderTiles();
});

// ---------- Tiles ----------
function renderTiles() {
  const shown = items.filter((i) => cat === "All" || i.category === cat);
  if (!shown.length) {
    $("tiles").innerHTML = `<p class="muted">Nothing on the menu yet. Add items in Admin → Menu.</p>`;
    return;
  }
  $("tiles").innerHTML = shown.map((i) => {
    const out = isOut(i.id);
    const asking = tileMenu === i.id;
    return `
      <div class="tile ${out ? "is-out" : ""} cat-${i.category.toLowerCase()}">
        <button class="tile-main" type="button" data-add="${esc(i.id)}" ${out ? "disabled" : ""}
                aria-label="Add ${esc(i.name)} ${esc(i.label)} ${rm(i.price)}">
          <span class="tile-name">${esc(i.name)}</span>
          ${i.label ? `<span class="tile-label">${esc(i.label)}</span>` : ""}
          <span class="tile-price">${out ? "SOLD OUT" : rm(i.price)}</span>
        </button>
        ${asking ? `
          <div class="tile-ask">
            <span>${out ? "Back in stock?" : "Sold out?"}</span>
            <button class="btn small ${out ? "primary" : "danger"}" type="button" data-out-yes="${esc(i.id)}">Yes</button>
            <button class="btn small ghost" type="button" data-out-no>No</button>
          </div>` : `
          <button class="tile-more" type="button" data-more="${esc(i.id)}"
                  aria-label="${out ? "Mark back in stock" : "Mark sold out"}: ${esc(i.name)}">⋯</button>`}
      </div>`;
  }).join("");
}

$("tiles").addEventListener("click", (e) => {
  const add = e.target.closest("[data-add]");
  const more = e.target.closest("[data-more]");
  const yes = e.target.closest("[data-out-yes]");
  const no = e.target.closest("[data-out-no]");
  if (add) addToCart(add.dataset.add);
  if (more) { tileMenu = more.dataset.more; renderTiles(); }
  if (no) { tileMenu = null; renderTiles(); }
  if (yes) {
    const id = yes.dataset.outYes;
    const item = items.find((i) => i.id === id);
    const nowOut = !isOut(id);
    setDoc(doc(db, "soldout", id), { soldOut: nowOut, by: currentCode(), at: Date.now() })
      .catch(() => flash("Couldn't change sold out. Ask Navin to update the security rules.", true));
    if (nowOut) cart = cart.filter((l) => l.item.id !== id);
    flash(`${item ? item.name : "Item"} ${nowOut ? "marked sold out" : "back in stock"}.`);
    tileMenu = null; renderTiles(); renderCart();
  }
});

// ---------- Cart ----------
// Tapping a tile: combos ask what's inside, "by pieces" items ask how many, others go straight in.
function addToCart(id) {
  const item = items.find((i) => i.id === id);
  if (!item || isOut(id)) return;
  $("orderMsg").textContent = "";
  if (item.category === "Combo" && item.picks.length) return askCombo(item);
  if (item.pieces) return askPieces(item);
  pushLine({ item, price: item.price, label: item.label });
}

// Same item + same choices + same price = one line with qty > 1
function pushLine({ item, price, label, parts = null, pcs = null }) {
  const key = [item.id, label, price, parts ? parts.map((p) => p.itemId).join("+") : ""].join("|");
  const line = cart.find((l) => l.key === key);
  if (line) line.qty += 1;
  else cart.push({
    key, itemId: item.id, name: item.name, label, price, qty: 1,
    category: item.category, station: parts ? "combo" : stationOf(item),
    parts, pcs, priceEdited: price !== item.price && !pcs,
  });
  renderCart();
}

// ----- pop-up helper -----
let dlgDone = null;
function openDlg(title, bodyHtml, okText, onOk) {
  $("dlgTitle").textContent = title;
  $("dlgBody").innerHTML = bodyHtml;
  $("dlgOk").textContent = okText;
  dlgDone = onOk;
  $("dlg").showModal();
}
$("dlgCancel").addEventListener("click", () => $("dlg").close());
$("dlgForm").addEventListener("submit", (e) => {
  e.preventDefault();
  if (dlgDone && dlgDone() !== false) $("dlg").close();
});

// ----- combo: pick one item from each category -----
const pickWord = (c) => c === "Drinks" ? "a drink" : c === "Food" ? "a snack" : c === "Dessert" ? "a dessert" : "one";
function askCombo(combo) {
  const groups = combo.picks.map((c) => {
    const opts = items.filter((i) => i.category === c && !isOut(i.id));
    return `<fieldset class="pick-group"><legend>Pick ${pickWord(c)}</legend>
      <div class="pick-opts">${opts.length ? opts.map((o, k) => `
        <label class="pick"><input type="radio" name="pick-${c}" value="${esc(o.id)}" ${k === 0 ? "checked" : ""}>
          <span>${esc(o.name)}${o.label ? ` <small>${esc(o.label)}</small>` : ""}</span></label>`).join("")
        : `<p class="muted">Nothing available in ${c}.</p>`}</div></fieldset>`;
  }).join("");
  openDlg(`${combo.name} · ${rm(combo.price)}`, groups, "Add combo", () => {
    const parts = [];
    for (const c of combo.picks) {
      const v = $("dlgBody").querySelector(`input[name="pick-${c}"]:checked`)?.value;
      const it = items.find((i) => i.id === v);
      if (!it) { flash(`Pick something from ${c}.`, true); return false; }
      parts.push({ itemId: it.id, name: it.name, label: it.label, category: it.category, station: stationOf(it) });
    }
    pushLine({ item: combo, price: combo.price, label: parts.map((x) => x.name).join(" + "), parts });
  });
}

// ----- pieces: how many pcs? -----
let piecesItem = null;
function piecePrice(item, n) {
  return n === item.pieces.full ? item.price : round2(n * item.pieces.perPiece);
}
function askPieces(item) {
  const full = item.pieces.full;
  const btns = Array.from({ length: full }, (_, k) => k + 1).map((n) =>
    `<button class="btn pcs ${n === full ? "active" : ""}" type="button" data-pcs="${n}">${n}</button>`).join("");
  piecesItem = item;
  openDlg(`${item.name} · how many pieces?`, `
    <div class="pcs-row" role="group" aria-label="Pieces">${btns}</div>
    <label class="field">Price (RM) <input id="pcsPrice" type="number" min="0" step="0.5" value="${item.price}"></label>
    <p class="muted">${full} pcs = ${rm(item.price)} · fewer = ${rm(item.pieces.perPiece)} each. You can change the price.</p>`,
    "Add", () => {
      const n = Number($("dlgBody").querySelector(".pcs.active")?.dataset.pcs) || full;
      const price = round2(Number($("pcsPrice").value) || 0);
      pushLine({ item, price, label: `${n} pcs`, pcs: n });
    });
}
$("dlgBody").addEventListener("click", (e) => {
  const b = e.target.closest("[data-pcs]"); if (!b || !piecesItem) return;
  $("dlgBody").querySelectorAll(".pcs").forEach((x) => x.classList.toggle("active", x === b));
  $("pcsPrice").value = piecePrice(piecesItem, Number(b.dataset.pcs));
});

// ----- change the price of a line -----
function askPrice(i) {
  const l = cart[i];
  piecesItem = null;
  openDlg(`Price for ${l.name}${l.label ? " (" + l.label + ")" : ""}`, `
    <label class="field">Price for one (RM) <input id="newPrice" type="number" min="0" step="0.5" value="${l.price}"></label>
    <p class="muted">Use this for a discount or a special deal. It applies to this order only.</p>`,
    "Set price", () => {
      const v = round2(Number($("newPrice").value));
      if (!(v >= 0)) return false;
      l.price = v; l.priceEdited = true;
      renderCart();
    });
  setTimeout(() => $("newPrice")?.select(), 30);
}

const cartTotal = () => round2(cart.reduce((s, l) => s + l.price * l.qty, 0));

function renderCart() {
  // drop anything that was switched off or sold out meanwhile
  cart = cart.filter((l) => items.some((i) => i.id === l.itemId) && !isOut(l.itemId)
    && !(l.parts || []).some((p) => isOut(p.itemId)));
  $("cartList").innerHTML = cart.length ? cart.map((l, i) => `
    <li class="cart-line">
      <span class="cart-name">${esc(l.name)}${l.label ? ` <small>${esc(l.label)}</small>` : ""}</span>
      <span class="qty">
        <button class="btn small" type="button" data-dec="${i}" aria-label="One less ${esc(l.name)}">−</button>
        <b>${l.qty}</b>
        <button class="btn small" type="button" data-inc="${i}" aria-label="One more ${esc(l.name)}">+</button>
      </span>
      <button class="cart-sum price-btn ${l.priceEdited ? "edited" : ""}" type="button" data-price="${i}"
              aria-label="Change price of ${esc(l.name)}">${rm(l.price * l.qty)}</button>
    </li>`).join("") : `<li class="muted empty">Tap items to add them.</li>`;
  $("cartTotal").textContent = rm(cartTotal());
  $("qrAmount").textContent = rm(cartTotal());
  updateChange(); updateCharge();
}
$("cartList").addEventListener("click", (e) => {
  const inc = e.target.closest("[data-inc]");
  const dec = e.target.closest("[data-dec]");
  const pr = e.target.closest("[data-price]");
  if (pr) return askPrice(Number(pr.dataset.price));
  if (inc) cart[Number(inc.dataset.inc)].qty += 1;
  if (dec) {
    const i = Number(dec.dataset.dec);
    cart[i].qty -= 1;
    if (cart[i].qty <= 0) cart.splice(i, 1);
  }
  renderCart();
});

function clearOrder() {
  cart = []; $("custName").value = ""; $("received").value = "";
  setPay("cash"); renderCart();
}
$("clearBtn").addEventListener("click", clearOrder);

// ---------- Payment ----------
function setPay(m) {
  pay = m;
  document.querySelectorAll("[data-pay]").forEach((b) => b.classList.toggle("active", b.dataset.pay === m));
  $("cashBox").hidden = m !== "cash";
  $("qrBox").hidden = m !== "qr";
  $("freeBox").hidden = m !== "free";
  updateCharge();
}
document.querySelector(".pay-toggle").addEventListener("click", (e) => {
  const b = e.target.closest("[data-pay]");
  if (b) setPay(b.dataset.pay);
});
document.querySelector(".quick-cash").addEventListener("click", (e) => {
  const b = e.target.closest("[data-cash]");
  if (!b) return;
  $("received").value = b.dataset.cash === "exact" ? cartTotal() : b.dataset.cash;
  updateChange();
});
$("received").addEventListener("input", updateChange);

function updateChange() {
  const got = parseFloat($("received").value);
  if (!got || !cart.length) { $("change").textContent = "–"; $("change").className = ""; return; }
  const diff = round2(got - cartTotal());
  $("change").textContent = diff >= 0 ? rm(diff) : "Short " + rm(-diff);
  $("change").className = diff >= 0 ? "ok" : "short";
}
function updateCharge() {
  const b = $("chargeBtn");
  b.disabled = !cart.length;
  b.textContent = !cart.length ? "Charge"
    : pay === "free" ? "Record free order"
    : `Charge ${rm(cartTotal())} · ${PAY_LABEL[pay]}`;
}

// ---------- Save ----------
const nextNumber = () => orders.reduce((m, o) => Math.max(m, o.no || 0), 0) + 1;

$("chargeBtn").addEventListener("click", () => {
  if (!cart.length) return;
  if (todayKey() !== day) { day = todayKey(); orders = []; listen(); }

  const now = Date.now();
  const lines = cart.map((l) => ({
    itemId: l.itemId, name: l.name, label: l.label, size: l.label,
    category: l.category, station: l.station, price: l.price, qty: l.qty,
    parts: l.parts || null, pcs: l.pcs || null, priceEdited: !!l.priceEdited,
    friendItem: false, instant: l.station === "counter", cost: 0, recipe: [],
  }));
  const total = cartTotal();
  // Which kitchen stations have something to make? (null = nothing for them)
  const needs = (st) => lines.some((l) => l.station === st || (l.parts || []).some((p) => p.station === st));
  const allInstant = !needs("drinks") && !needs("snacks");
  const name = $("custName").value.trim();
  const order = {
    no: nextNumber(), day, name,
    items: lines,
    listTotal: total,
    total: pay === "free" ? 0 : total,
    pay,
    freeReason: pay === "free" ? $("freeReason").value : null,
    status: allInstant ? "collected" : "preparing",
    createdAt: now,
    readyAt: allInstant ? now : null,
    collectedAt: allInstant ? now : null,
    voidReason: null,
    drinksDone: needs("drinks") ? false : null,
    snacksDone: needs("snacks") ? false : null,
    by: currentCode(),
  };
  const batch = writeBatch(db);
  batch.set(doc(collection(db, "orders")), order);
  batch.commit().catch(showError);   // no await: works through short Wi-Fi drops

  flash(allInstant ? `Saved. Hand it over${name ? " to " + name : ""}.` : `Saved. ${name || "Order"} is in To serve.`);
  clearOrder();
});

// ---------- Queue: orders still to serve ----------
function ago(ms) {
  const m = Math.floor((Date.now() - ms) / 60000);
  return m < 1 ? "just now" : m + " min";
}
// "Drinks ✓ · Snacks …" for orders the kitchen is working on
function progress(o) {
  const chip = (label, v) => v === null || v === undefined ? "" :
    `<span class="chip ${v ? "done" : ""}">${label} ${v ? "✓ ready" : "…"}</span>`;
  const c = chip("Drinks", o.drinksDone) + chip("Snacks", o.snacksDone);
  return c ? `<div class="chips">${c}</div>` : "";
}
// every kitchen station that had work has finished
const kitchenDone = (o) => (o.drinksDone === undefined && o.snacksDone === undefined) ? false
  : (o.drinksDone !== false) && (o.snacksDone !== false);

function renderQueue() {
  // orders where every station has finished are complete: tidy them up
  orders.filter((o) => o.status === "preparing" && kitchenDone(o)).forEach((o) => {
    const b = writeBatch(db);
    b.update(doc(db, "orders", o.id), { status: "collected", collectedAt: Date.now() });
    b.commit().catch(() => {});
  });
  const waiting = orders.filter((o) => (o.status === "preparing" || o.status === "ready") && !kitchenDone(o));
  $("queueCount").textContent = waiting.length ? waiting.length : "";
  $("queueList").innerHTML = waiting.length ? waiting.map((o) => `
    <li class="q-row">
      <div class="q-top">
        <b class="q-name">${esc(o.name) || "No name"}</b>
        <span class="muted">${timeOf(o.createdAt)} · ${ago(o.createdAt)}</span>
      </div>
      <ul class="q-items">${o.items.map((l) =>
        `<li><b>${l.qty}×</b> ${esc(l.name)}${(l.label || l.size) ? ` <small>${esc(l.label || l.size)}</small>` : ""}${l.priceEdited ? ` <small class="edited">${rm(l.price)}</small>` : ""}</li>`).join("")}</ul>
      ${progress(o)}
      <button class="btn primary small q-done" type="button" data-done="${o.id}">Done · handed over</button>
    </li>`).join("") : `<li class="muted empty">All served.</li>`;
}
$("queueList").addEventListener("click", (e) => {
  const b = e.target.closest("[data-done]");
  if (!b) return;
  const batch = writeBatch(db);
  batch.update(doc(db, "orders", b.dataset.done), { status: "collected", collectedAt: Date.now() });
  batch.commit().catch(showError);
});
setInterval(renderQueue, 30000);   // keep the "x min" fresh

// ---------- Last orders (void) ----------
function renderRecent() {
  const recent = [...orders].reverse().slice(0, 12);
  $("recentList").innerHTML = recent.length ? recent.map((o) => {
    const isVoid = o.status === "void";
    return `
      <li class="order-row ${isVoid ? "is-void" : ""}">
        <div><b>${esc(o.name) || "No name"}</b> <span class="muted">${timeOf(o.createdAt)}</span>
          <span class="pill">${PAY_LABEL[o.pay] || o.pay}</span> <b>${rm(o.total)}</b>
          ${isVoid ? `<span class="pill danger">void</span>` : ""}</div>
        <div class="muted">${o.items.map((l) => `${l.qty}× ${esc(l.name)}`).join(", ")}</div>
        ${isVoid ? "" : voidingId === o.id ? `
          <div class="void-form">
            <select id="voidReason" aria-label="Void reason">
              <option>Wrong item entered</option><option>Customer cancelled</option>
              <option>Entered twice</option><option>Test order</option><option>Other</option>
            </select>
            <button class="btn small danger" type="button" data-void-yes="${o.id}">Void</button>
            <button class="btn small ghost" type="button" data-void-no>Keep</button>
          </div>` : `<button class="btn small ghost" type="button" data-void="${o.id}">Void</button>`}
      </li>`;
  }).join("") : `<li class="muted">No orders yet today.</li>`;
}
$("recentList").addEventListener("click", (e) => {
  const s = e.target.closest("[data-void]");
  const y = e.target.closest("[data-void-yes]");
  const n = e.target.closest("[data-void-no]");
  if (s) { voidingId = s.dataset.void; renderRecent(); }
  if (n) { voidingId = null; renderRecent(); }
  if (y) {
    const batch = writeBatch(db);
    batch.update(doc(db, "orders", y.dataset.voidYes), {
      status: "void", voidReason: $("voidReason").value, voidedAt: Date.now(), voidedBy: currentCode(),
    });
    batch.commit().catch(showError);
    voidingId = null;
  }
});

// ---------- Messages ----------
let flashTimer = null;
function flash(text, bad = false) {
  $("orderMsg").textContent = text;
  $("orderMsg").classList.toggle("bad", bad);
  clearTimeout(flashTimer);
  flashTimer = setTimeout(() => { $("orderMsg").textContent = ""; }, 3500);
}
function showError(err) {
  console.error(err);
  flash("Problem saving: " + (err.code || err.message) + ". Check the internet.", true);
}

renderCart();
