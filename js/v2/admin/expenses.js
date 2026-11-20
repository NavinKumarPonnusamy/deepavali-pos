// js/v2/admin/expenses.js — "Expenses" tab: log anything you spend.
import { db } from "../../firebase.js";
import { collection, doc, addDoc, deleteDoc } from "https://www.gstatic.com/firebasejs/13.0.0/firebase-firestore.js";
import { rm, todayKey, esc, round2 } from "../../utils.js";
import { currentCode } from "../../auth-gate.js";
import { state, onChange } from "./data.js";
import { allExpenses, EXPENSE_CATS } from "./calc.js";

const $ = (id) => document.getElementById(id);
let deleting = null;

export function init() {
  $("eCat").innerHTML = EXPENSE_CATS.filter((c) => c !== "Salary").map((c) => `<option>${c}</option>`).join("");
  $("eDate").value = todayKey();
  onChange((w) => { if (w === "expenses" || w === "days") render(); });

  $("expForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    const amount = round2(Number($("eAmount").value));
    if (!(amount > 0)) { $("expMsg").textContent = "Enter an amount above 0."; return; }
    const entry = {
      date: $("eDate").value || todayKey(), what: $("eWhat").value.trim(), amount,
      category: $("eCat").value, note: $("eNote").value.trim(),
      source: "manual", createdAt: Date.now(), by: currentCode(),
    };
    try {
      await addDoc(collection(db, "expenses"), entry);
      $("expMsg").textContent = `Added: ${entry.what} ${rm(amount)}.`;
      $("eWhat").value = ""; $("eAmount").value = ""; $("eNote").value = ""; $("eWhat").focus();
    } catch (err) { $("expMsg").textContent = "Couldn't add: " + (err.code || err.message); }
  });

  $("expBody").addEventListener("click", async (e) => {
    const d = e.target.closest("[data-del]"), y = e.target.closest("[data-del-yes]"), n = e.target.closest("[data-del-no]");
    if (d) { deleting = d.dataset.del; render(); }
    if (n) { deleting = null; render(); }
    if (y) {
      try { await deleteDoc(doc(db, "expenses", y.dataset.delYes)); }
      catch (err) { $("expMsg").textContent = "Couldn't delete: " + (err.code || err.message); }
      deleting = null; render();
    }
  });
}

const nice = (d) => d ? new Date(d + "T00:00").toLocaleDateString("en-MY", { day: "numeric", month: "short" }) : "–";

function render() {
  const list = allExpenses(state);
  $("expTotal").textContent = rm(list.reduce((s, e) => s + e.amount, 0));
  $("expBody").innerHTML = list.length ? list.map((e) => `
    <tr>
      <td>${nice(e.date)}</td>
      <td>${esc(e.what)} ${e.note ? `<span class="muted">· ${esc(e.note)}</span>` : ""}</td>
      <td><span class="tagpill">${esc(e.category || "Other")}</span></td>
      <td class="num">${rm(e.amount)}</td>
      <td>${e.source === "salary" ? `<span class="muted">from closing</span>`
          : e.source === "legacy" ? `<span class="muted">old screen</span>`
          : deleting === e.id ? `<span class="confirm"><button class="btn small danger" type="button" data-del-yes="${e.id}">Delete</button>
              <button class="btn small ghost" type="button" data-del-no>Keep</button></span>`
          : `<button class="btn small ghost" type="button" data-del="${e.id}" aria-label="Delete ${esc(e.what)}">Delete</button>`}</td>
    </tr>`).join("") : `<tr><td colspan="5" class="muted">No expenses yet.</td></tr>`;

  const cats = {};
  list.forEach((e) => { cats[e.category || "Other"] = (cats[e.category || "Other"] || 0) + e.amount; });
  $("expCatBody").innerHTML = Object.entries(cats).sort((a, b) => b[1] - a[1])
    .map(([c, v]) => `<tr><td>${esc(c)}</td><td class="num">${rm(v)}</td></tr>`).join("") || `<tr><td class="muted">Nothing yet.</td></tr>`;
}
