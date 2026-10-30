// js/admin.js
// Admin panel: edit the menu (names, sizes, prices, costs), add / hide / delete / reorder items,
// and switch floor mode. Only people listed in the "roles" collection as admin get in.
//
// How editing works:
//   saved = the menu exactly as it is in Firestore
//   draft = a copy that you edit on screen
// Nothing reaches the database until you press "Save menu", so a half-finished edit
// never shows up on the cashier screen.

import { db } from "./firebase.js";
import { doc, getDoc, onSnapshot, setDoc }
  from "https://www.gstatic.com/firebasejs/13.0.0/firebase-firestore.js";
import { startAuth, logout, emailToCode } from "./auth-gate.js";
import { esc } from "./utils.js";

const $ = (id) => document.getElementById(id);
const clone = (x) => JSON.parse(JSON.stringify(x));

let saved = null;
let draft = null;
let dirty = false;           // true = there are unsaved changes
let deletingIndex = null;    // which item is showing "Delete? Yes / No"
let unsub = null;

// ---------- Sign in + admin check ----------
startAuth({
  onSignedIn: async (user) => {
    $("who").textContent = emailToCode(user.email);
    // Admins are listed in Firestore: roles/{userId} = { role: "admin" }
    const role = await getDoc(doc(db, "roles", user.uid));
    const isAdmin = role.exists() && ["admin", "owner"].includes(role.data().role);
    $("noAccess").hidden = isAdmin;
    $("editor").hidden = !isAdmin;
    $("myUid").textContent = user.uid;
    if (isAdmin) listen();
  },
  onSignedOut: () => { if (unsub) unsub(); unsub = null; },
});
$("logoutBtn").addEventListener("click", logout);

function listen() {
  if (unsub) unsub();
  unsub = onSnapshot(doc(db, "menu", "main"), (snap) => {
    // Our own save shows up here instantly, before the server confirms it.
    // Skip that echo, or it would look like "someone else changed the menu".
    if (snap.metadata.hasPendingWrites) return;
    saved = snap.exists() ? snap.data() : { items: [], floorMode: false };
    if (!dirty) {
      draft = clone(saved);
      render();
    } else {
      // Someone else saved while we were editing: warn instead of wiping our edits.
      $("conflict").hidden = false;
    }
  }, (err) => setState("Could not load the menu: " + err.code));
}

// ---------- Draw the editor ----------
function render() {
  $("floorMode").checked = !!draft.floorMode;
  $("conflict").hidden = true;

  $("items").innerHTML = draft.items.length ? draft.items.map((it, i) => `
    <article class="panel item-card ${it.active ? "" : "is-hidden"}" data-i="${i}">
      <div class="item-head">
        <input class="item-name" data-field="name" value="${esc(it.name)}" placeholder="Item name" aria-label="Item name">
        <label class="check"><input type="checkbox" data-field="active" ${it.active ? "checked" : ""}> Shown on menu</label>
      </div>

      <div class="checks">
        <label class="check"><input type="checkbox" data-field="instant" ${it.instant ? "checked" : ""}>
          Hand over instantly (skips the kitchen)</label>
        <label class="check"><input type="checkbox" data-field="friendItem" ${it.friendItem ? "checked" : ""}>
          Friend's item (own column in reports)</label>
      </div>

      <div class="table-wrap">
        <table class="sizes">
          <thead><tr><th>Size</th><th>Price (RM)</th><th>Cost (RM)</th><th></th></tr></thead>
          <tbody>
            ${it.sizes.map((s, j) => `
              <tr>
                <td><input data-size="${j}" data-sfield="label" value="${esc(s.label)}" placeholder="none" aria-label="Size name"></td>
                <td><input type="number" min="0" step="0.1" data-size="${j}" data-sfield="price" value="${s.price}" aria-label="Price"></td>
                <td><input type="number" min="0" step="0.01" data-size="${j}" data-sfield="cost" value="${s.cost}" aria-label="Cost"></td>
                <td>${it.sizes.length > 1
                  ? `<button class="btn small ghost" type="button" data-act="remove-size" data-size="${j}">Remove</button>` : ""}</td>
              </tr>`).join("")}
          </tbody>
        </table>
      </div>

      <div class="item-actions">
        <button class="btn small" type="button" data-act="add-size">+ Add size</button>
        <button class="btn small ghost" type="button" data-act="up" ${i === 0 ? "disabled" : ""} aria-label="Move up">↑ Up</button>
        <button class="btn small ghost" type="button" data-act="down" ${i === draft.items.length - 1 ? "disabled" : ""} aria-label="Move down">↓ Down</button>
        ${deletingIndex === i
          ? `<span class="confirm">Delete ${esc(it.name || "this item")}?
               <button class="btn small danger" type="button" data-act="delete-yes">Delete</button>
               <button class="btn small ghost" type="button" data-act="delete-no">Keep</button></span>`
          : `<button class="btn small ghost" type="button" data-act="delete">Delete item</button>`}
      </div>
    </article>`).join("")
    : `<p class="muted">No items yet. Press "+ Add item".</p>`;

  updateSaveBar();
}

// ---------- Typing / ticking boxes (no re-render, so the cursor stays put) ----------
$("items").addEventListener("input", (e) => {
  const card = e.target.closest("[data-i]");
  if (!card) return;
  const item = draft.items[Number(card.dataset.i)];
  const t = e.target;

  if (t.dataset.field) {
    item[t.dataset.field] = t.type === "checkbox" ? t.checked : t.value;
    if (t.dataset.field === "active") card.classList.toggle("is-hidden", !t.checked);
  }
  if (t.dataset.sfield) {
    const size = item.sizes[Number(t.dataset.size)];
    size[t.dataset.sfield] = t.dataset.sfield === "label" ? t.value : t.value === "" ? "" : Number(t.value);
  }
  markDirty();
});

$("floorMode").addEventListener("change", (e) => {
  draft.floorMode = e.target.checked;
  markDirty();
});

// ---------- Buttons inside item cards ----------
$("items").addEventListener("click", (e) => {
  const btn = e.target.closest("[data-act]");
  if (!btn) return;
  const i = Number(btn.closest("[data-i]").dataset.i);
  const items = draft.items;

  switch (btn.dataset.act) {
    case "add-size":
      items[i].sizes.push({ label: "", price: 0, cost: 0 });
      break;
    case "remove-size":
      items[i].sizes.splice(Number(btn.dataset.size), 1);
      break;
    case "up":
      [items[i - 1], items[i]] = [items[i], items[i - 1]];   // swap with the one above
      break;
    case "down":
      [items[i + 1], items[i]] = [items[i], items[i + 1]];   // swap with the one below
      break;
    case "delete":
      deletingIndex = i; render(); return;                   // just show the confirm buttons
    case "delete-no":
      deletingIndex = null; render(); return;
    case "delete-yes":
      items.splice(i, 1);
      deletingIndex = null;
      break;
  }
  markDirty();
  render();
});

$("addItemBtn").addEventListener("click", () => {
  draft.items.push({
    id: "",                    // gets a permanent id when you save
    name: "",
    sizes: [{ label: "", price: 0, cost: 0 }],
    instant: false,
    friendItem: false,
    active: false,             // new items start hidden, so a half-made item never shows up
  });
  markDirty();
  render();
  // jump to the new card and put the cursor in its name box
  const names = document.querySelectorAll(".item-name");
  names[names.length - 1].focus();
});

// ---------- Save / discard ----------
function markDirty() {
  dirty = true;
  updateSaveBar();
}

function updateSaveBar() {
  $("saveBtn").disabled = !dirty;
  $("discardBtn").disabled = !dirty;
  $("saveState").textContent = dirty ? "You have unsaved changes" : "All changes saved";
}

function discard() {
  dirty = false;
  deletingIndex = null;
  draft = clone(saved);
  render();
}
$("discardBtn").addEventListener("click", discard);
$("discardBtn2").addEventListener("click", discard);

// Turns "Masala Corn!" into "masala-corn"
const slug = (s) => s.toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "item";

// Returns a list of problems. Empty list = OK to save.
function check(menu) {
  const problems = [];
  menu.items.forEach((it, n) => {
    const name = it.name.trim() || `Item ${n + 1}`;
    if (!it.name.trim()) problems.push(`Item ${n + 1} has no name.`);
    if (!it.sizes.length) problems.push(`${name} needs at least one size.`);
    const labels = it.sizes.map((s) => s.label.trim());
    if (it.sizes.length > 1 && labels.some((l) => !l)) problems.push(`${name}: give every size a name (e.g. R, L).`);
    if (new Set(labels).size !== labels.length) problems.push(`${name}: two sizes have the same name.`);
    it.sizes.forEach((s) => {
      if (typeof s.price !== "number" || s.price < 0) problems.push(`${name}: price must be a number, 0 or more.`);
      if (s.cost !== "" && (typeof s.cost !== "number" || s.cost < 0)) problems.push(`${name}: cost must be a number, 0 or more.`);
    });
  });
  return problems;
}

$("saveBtn").addEventListener("click", async () => {
  const menu = clone(draft);

  // tidy up: trim text, blank cost = 0
  menu.items.forEach((it) => {
    it.name = it.name.trim();
    it.sizes.forEach((s) => { s.label = s.label.trim(); if (s.cost === "") s.cost = 0; });
  });

  const problems = check(menu);
  if (problems.length) { setState("Can't save yet: " + problems.join(" ")); return; }

  // Give new items a permanent id. The id never changes after this, even if you rename
  // the item, so reports still group "Tara" and "Tara Fizz" as the same drink.
  const used = new Set(menu.items.map((it) => it.id).filter(Boolean));
  menu.items.forEach((it) => {
    if (it.id) return;
    let id = slug(it.name), k = 2;
    while (used.has(id)) id = slug(it.name) + "-" + k++;
    used.add(id);
    it.id = id;
  });

  $("saveBtn").disabled = true;
  setState("Saving…");
  try {
    await setDoc(doc(db, "menu", "main"), menu);
    dirty = false;
    deletingIndex = null;
    draft = menu;
    render();
    setState("Saved. The cashier screen has the new menu.");
  } catch (err) {
    setState("Save failed: " + err.code + ". Check the connection and try again.");
    $("saveBtn").disabled = false;
  }
});

function setState(text) {
  $("saveState").textContent = text;
}

// Warn before leaving the page with unsaved changes
window.addEventListener("beforeunload", (e) => {
  if (dirty) { e.preventDefault(); e.returnValue = ""; }
});
