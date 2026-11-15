// js/auth-gate.js
// Shared login logic. Every screen calls startAuth() once.
// The page needs:  <div id="login"></div>  and  <main id="app" hidden>...</main>
//
// People log in with a short CODE (e.g. "kavin") instead of an email.
// Firebase only understands emails, so we turn the code into
// "kavin@boothpos.local" behind the scenes. In the Firebase console,
// create each account with that full fake email.

import { auth } from "./firebase.js";
import { signInWithEmailAndPassword, signOut, onAuthStateChanged }
  from "https://www.gstatic.com/firebasejs/13.0.0/firebase-auth.js";

const DOMAIN = "@boothpos.local";

// Accepts either a short code ("kavin") or a full email ("navin@gmail.com").
const codeToEmail = (input) => {
  const v = input.trim().toLowerCase();
  return v.includes("@") ? v : v + DOMAIN;
};

// "kavin@boothpos.local" -> "kavin"   (used to show and record who is logged in)
export const emailToCode = (email) => (email || "").replace(DOMAIN, "");

// The code of whoever is signed in right now, e.g. "kavin"
export const currentCode = () => emailToCode(auth.currentUser?.email);

export function startAuth({ onSignedIn, onSignedOut }) {
  const box = document.getElementById("login");
  const app = document.getElementById("app");

  box.innerHTML = `
    <form id="loginForm" class="login-card">
      <h2>Sign in</h2>
      <label>Code or email <input id="loginCode" required autocomplete="username"
             autocapitalize="none" spellcheck="false" placeholder="e.g. kavin"></label>
      <label>Password <input id="loginPassword" type="password" required autocomplete="current-password"></label>
      <button class="btn primary" type="submit">Sign in</button>
      <p id="loginError" class="error"></p>
    </form>`;

  document.getElementById("loginForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    const err = document.getElementById("loginError");
    err.textContent = "";
    try {
      await signInWithEmailAndPassword(
        auth,
        codeToEmail(document.getElementById("loginCode").value),
        document.getElementById("loginPassword").value
      );
    } catch (ex) {
      err.textContent = "Wrong code or password. Try again.";
      console.error(ex.code);
    }
  });

  // Firebase remembers the login, so this fires with the user on page load
  // and the login form is skipped on later visits.
  onAuthStateChanged(auth, (user) => {
    box.hidden = !!user;
    app.hidden = !user;
    if (user) onSignedIn(user);
    else if (onSignedOut) onSignedOut();
  });
}

export const logout = () => signOut(auth);
