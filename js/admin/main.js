// js/admin/main.js
// Starts the admin dashboard: sign-in, admin check, tabs, and each tab's module.

import { db } from "../firebase.js";
import { doc, getDoc } from "https://www.gstatic.com/firebasejs/13.0.0/firebase-firestore.js";
import { startAuth, logout, emailToCode } from "../auth-gate.js";
import { startData, stopData } from "./data.js";
import * as sales from "./sales.js";
import * as menu from "./menu.js";
import * as stock from "./stock.js";
import * as closing from "./closing.js";

const $ = (id) => document.getElementById(id);
const TABS = ["overview", "sales", "menu", "stock", "closing"];

// Each tab module wires up its own buttons and listens for data changes.
sales.init();
menu.init();
stock.init();
closing.init();

startAuth({
  onSignedIn: async (user) => {
    $("who").textContent = emailToCode(user.email);
    $("myUid").textContent = user.uid;
    // Admins are listed in Firestore: roles/{userId} = { role: "admin" } (or "owner")
    const role = await getDoc(doc(db, "roles", user.uid));
    const ok = role.exists() && ["admin", "owner"].includes(role.data().role);
    $("noAccess").hidden = ok;
    $("adminApp").hidden = !ok;
    if (ok) startData((err) => { $("dataError").textContent = "Couldn't load some data: " + (err.code || err.message); });
  },
  onSignedOut: stopData,
});
$("logoutBtn").addEventListener("click", logout);

// ---------- Tabs ----------
// The open tab is kept in the address (admin.html#stock) so a refresh stays on it.
function showTab(name) {
  if (!TABS.includes(name)) name = "overview";
  TABS.forEach((t) => {
    $("tab-" + t).hidden = t !== name;
    const btn = document.querySelector(`[data-tab="${t}"]`);
    btn.setAttribute("aria-selected", t === name ? "true" : "false");
    btn.classList.toggle("active", t === name);
  });
  history.replaceState(null, "", "#" + name);
}
document.querySelector(".tabs").addEventListener("click", (e) => {
  const b = e.target.closest("[data-tab]");
  if (b) showTab(b.dataset.tab);
});
showTab(location.hash.slice(1));
