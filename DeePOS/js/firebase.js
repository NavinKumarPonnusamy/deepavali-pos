// js/firebase.js
// One place to start Firebase. Every page imports { db, auth } from here,
// so if the config or SDK version ever changes, you edit only this file.

import { initializeApp } from "https://www.gstatic.com/firebasejs/13.0.0/firebase-app.js";
import { getFirestore } from "https://www.gstatic.com/firebasejs/13.0.0/firebase-firestore.js";
import { getAuth } from "https://www.gstatic.com/firebasejs/13.0.0/firebase-auth.js";

// This config only identifies the project; it is not a secret.
// Real protection comes from Firestore security rules (a later step).
const firebaseConfig = {
  apiKey: "AIzaSyBmkMxiLiV7KvM15vJWs_Y0AkCbKmEwhhQ",
  authDomain: "booth-pos-294e0.firebaseapp.com",
  projectId: "booth-pos-294e0",
  storageBucket: "booth-pos-294e0.firebasestorage.app",
  messagingSenderId: "382595771834",
  appId: "1:382595771834:web:66a7539c33b12596688183",
};

export const app = initializeApp(firebaseConfig);
export const db = getFirestore(app);
export const auth = getAuth(app);
