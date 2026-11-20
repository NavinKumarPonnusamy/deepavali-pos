// js/v2/theme.js — light / dark switch for the v2 pages. Remembers the choice on this device.
const KEY = "cupcha-theme";
const root = document.documentElement;
function apply(t) {
  root.dataset.theme = t;
  const b = document.getElementById("themeBtn");
  if (b) { b.textContent = t === "dark" ? "Light mode" : "Dark mode"; b.setAttribute("aria-pressed", t === "dark"); }
}
let saved = "light";
try { saved = localStorage.getItem(KEY) || "light"; } catch (e) { /* storage blocked: use light */ }
apply(saved);
document.getElementById("themeBtn")?.addEventListener("click", () => {
  const next = root.dataset.theme === "dark" ? "light" : "dark";
  apply(next);
  try { localStorage.setItem(KEY, next); } catch (e) { /* ignore */ }
});
