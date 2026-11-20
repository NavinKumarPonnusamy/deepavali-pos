// js/v2/admin/menu.js — "Menu" tab.
// Edit a copy ("draft"); nothing reaches the cashier until Save menu.
// Sold-out is separate: it changes straight away (same switch the cashier uses).
import { db } from "../../firebase.js";
import { doc, setDoc } from "https://www.gstatic.com/firebasejs/13.0.0/firebase-firestore.js";
import { esc, rm, timeOf } from "../../utils.js";
import { currentCode } from "../../auth-gate.js";
import { state, onChange } from "./data.js";
import { expandItems, toSaved, CATEGORIES, newId } from "../model.js";

const $ = (id) => document.getElementById(id);
let draft = null;
let dirty = false;
let deleting = null;
let justSaved = false;

export function init() {
  onChange((w) => {
    if (w === "menu") {
      if (state.menuPending) return;
      if (!dirty) { draft = expandItems(state.menu.items || []); render(); }
    }
    if (w === "soldout" && draft && !$("menuItems").contains(document.activeElement)) render();
  });

  $("addItemBtn").addEventListener("click", () => {
    draft.push({ id: newId(), name: "", label: "", price: 0, category: "Drinks", active: true, instant: false, pieces: null, picks: [] });
    setDirty(); render();
    const inputs = $("menuItems").querySelectorAll('[data-f="name"]');
    inputs[inputs.length - 1]?.focus();
  });
  $("discardBtn").addEventListener("click", () => { draft = expandItems(state.menu.items || []); dirty = false; deleting = null; render(); updateBar(); });
  $("saveBtn").addEventListener("click", save);

  $("menuItems").addEventListener("input", (e) => {
    const card = e.target.closest("[data-i]"); if (!card) return;
    const it = draft[Number(card.dataset.i)];
    if (e.target.dataset.p) { it.pieces[e.target.dataset.p] = Number(e.target.value) || 0; setDirty(); return; }
    if (e.target.dataset.pick) {
      const c = e.target.dataset.pick; it.picks = (it.picks || []).filter((x) => x !== c);
      if (e.target.checked) it.picks.push(c);
      setDirty(); return;
    }
    const f = e.target.dataset.f; if (!f) return;
    if (f === "byPieces") { it.pieces = e.target.checked ? { full: 6, perPiece: 1 } : null; setDirty(); render(); return; }
    it[f] = e.target.type === "checkbox" ? e.target.checked : f === "price" ? Number(e.target.value) : e.target.value;
    if (f === "active") card.classList.toggle("is-hidden", !it.active);
    if (f === "category") { if (it.category === "Combo" && !(it.picks || []).length) it.picks = ["Drinks", "Dessert"]; render(); }
    setDirty();
  });
  $("menuItems").addEventListener("click", (e) => {
    const b = e.target.closest("[data-act]"); if (!b) return;
    const i = Number(b.closest("[data-i]").dataset.i);
    const act = b.dataset.act;
    if (act === "up" && i > 0) { [draft[i - 1], draft[i]] = [draft[i], draft[i - 1]]; setDirty(); }
    if (act === "down" && i < draft.length - 1) { [draft[i + 1], draft[i]] = [draft[i], draft[i + 1]]; setDirty(); }
    if (act === "delete") deleting = i;
    if (act === "keep") deleting = null;
    if (act === "delete-yes") { draft.splice(i, 1); deleting = null; setDirty(); }
    if (act === "soldout") {
      const id = draft[i].id; const now = !state.soldout[id]?.soldOut;
      setDoc(doc(db, "soldout", id), { soldOut: now, by: currentCode(), at: Date.now() })
        .catch((err) => { $("saveState").textContent = "Couldn't change sold out: " + (err.code || err.message); });
    }
    render();
  });
}

function setDirty() { dirty = true; justSaved = false; updateBar(); }
function updateBar() {
  $("saveBtn").disabled = !dirty; $("discardBtn").disabled = !dirty;
  $("saveState").textContent = dirty ? "Unsaved changes" : justSaved ? "Saved ✓ The cashier has the new menu." : "No changes";
}

function render() {
  if (!draft) return;
  $("menuItems").innerHTML = draft.length ? draft.map((it, i) => {
    const so = state.soldout[it.id];
    return `
    <article class="panel menu-card ${it.active ? "" : "is-hidden"}" data-i="${i}">
      <div class="menu-row">
        <label class="field">Name <input data-f="name" value="${esc(it.name)}" maxlength="30" placeholder="e.g. Tara"></label>
        <label class="field">Label <input data-f="label" value="${esc(it.label)}" maxlength="15" placeholder="16oz"></label>
        <label class="field">Price (RM) <input data-f="price" type="number" min="0" step="0.5" value="${it.price}"></label>
        <label class="field">Category <select data-f="category">${CATEGORIES.map((c) => `<option ${c === it.category ? "selected" : ""}>${c}</option>`).join("")}</select></label>
        <div class="item-actions">
          <button class="btn small ghost" type="button" data-act="up" ${i === 0 ? "disabled" : ""} aria-label="Move up">↑</button>
          <button class="btn small ghost" type="button" data-act="down" ${i === draft.length - 1 ? "disabled" : ""} aria-label="Move down">↓</button>
        </div>
      </div>
      <div class="checks">
        <label class="check"><input type="checkbox" data-f="active" ${it.active ? "checked" : ""}> On the menu</label>
        <label class="check"><input type="checkbox" data-f="instant" ${it.instant ? "checked" : ""}> Hand over at the counter (not sent to the kitchen)</label>
        <label class="check"><input type="checkbox" data-f="byPieces" ${it.pieces ? "checked" : ""}> Sold by pieces</label>
      </div>
      ${it.pieces ? `<div class="menu-extra">
        <label class="check">Full plate <input type="number" min="1" max="12" step="1" data-p="full" value="${it.pieces.full}"> pcs = the price above</label>
        <label class="check">Fewer pieces: RM <input type="number" min="0" step="0.1" data-p="perPiece" value="${it.pieces.perPiece}"> each</label>
      </div>` : ""}
      ${it.category === "Combo" ? `<div class="menu-extra"><span>Customer picks 1 from:</span>
        ${CATEGORIES.filter((c) => c !== "Combo").map((c) => `<label class="check"><input type="checkbox" data-pick="${c}" ${(it.picks || []).includes(c) ? "checked" : ""}> ${c}</label>`).join("")}
      </div>` : ""}
      <div class="item-actions">
        <span class="sold-line">${so?.soldOut
          ? `<span class="danger">SOLD OUT</span> <span class="muted">· by ${esc(so.by || "?")} at ${timeOf(so.at)}</span>`
          : `<span class="muted">In stock${so?.by ? ` · last changed by ${esc(so.by)} at ${timeOf(so.at)}` : ""}</span>`}</span>
        <button class="btn small" type="button" data-act="soldout">${so?.soldOut ? "Back in stock" : "Mark sold out"}</button>
        ${deleting === i
          ? `<span class="confirm">Delete ${esc(it.name || "this item")}? <button class="btn small danger" type="button" data-act="delete-yes">Delete</button>
             <button class="btn small ghost" type="button" data-act="keep">Keep</button></span>`
          : `<button class="btn small ghost" type="button" data-act="delete">Delete</button>`}
      </div>
    </article>`;
  }).join("") : `<p class="muted">No items yet. Press + Add item.</p>`;
  updateBar();
}

async function save() {
  const bad = draft.find((it) => !it.name.trim() || !(it.price >= 0));
  if (bad) { $("saveState").textContent = "Every item needs a name and a price."; return; }
  $("saveBtn").disabled = true;
  try {
    await setDoc(doc(db, "menu", "main"), { ...state.menu, items: draft.map(toSaved) });
    dirty = false; justSaved = true; updateBar();
  } catch (err) {
    $("saveState").textContent = "Couldn't save: " + (err.code || err.message); $("saveBtn").disabled = false;
  }
}
