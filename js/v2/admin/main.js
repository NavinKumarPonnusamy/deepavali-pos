// js/v2/admin/main.js — starts the admin screen: sign-in, admin check, tabs.
import { db } from "../../firebase.js";
import { doc, getDoc } from "https://www.gstatic.com/firebasejs/13.0.0/firebase-firestore.js";
import { startAuth, logout, emailToCode } from "../../auth-gate.js";
import { startData, stopData } from "./data.js";
import * as day from "./day.js";
import * as menu from "./menu.js";
import * as expenses from "./expenses.js";
import * as summary from "./summary.js";

const $ = (id) => document.getElementById(id);
const TABS = ["today", "menu", "expenses", "summary"];

day.init(); menu.init(); expenses.init(); summary.init();

startAuth({
  onSignedIn: async (user) => {
    $("who").textContent = emailToCode(user.email);
    $("myUid").textContent = user.uid;
    const role = await getDoc(doc(db, "roles", user.uid));
    const ok = role.exists() && ["admin", "owner"].includes(role.data().role);
    $("noAccess").hidden = ok;
    $("adminApp").hidden = !ok;
    if (ok) startData((err) => { $("dataError").textContent = "Couldn't load some data: " + (err.code || err.message) + ". Did you publish the new security rules?"; });
  },
  onSignedOut: stopData,
});
$("logoutBtn").addEventListener("click", logout);

function showTab(name) {
  if (!TABS.includes(name)) name = "today";
  TABS.forEach((t) => {
    $("tab-" + t).hidden = t !== name;
    const b = document.querySelector(`[data-tab="${t}"]`);
    b.setAttribute("aria-selected", t === name ? "true" : "false");
    b.classList.toggle("active", t === name);
  });
  document.querySelector(".save-bar").hidden = name !== "menu";
  history.replaceState(null, "", "#" + name);
}
document.querySelector(".tabs").addEventListener("click", (e) => {
  const b = e.target.closest("[data-tab]");
  if (b) showTab(b.dataset.tab);
});
showTab(location.hash.slice(1));
