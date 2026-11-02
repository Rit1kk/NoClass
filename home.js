// home.js — Home page logic: date/time finder, live data counts, staff sign-in.
// Students need no account. Staff sign in with Google and must be on the staff
// list (one document per email in the "staff" collection).

import { db } from "./firebase-config.js";
import {
  collection, getCountFromServer, doc, getDoc
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

const $ = (s) => document.querySelector(s);
const $$ = (s) => [...document.querySelectorAll(s)];
const pad = (n) => String(n).padStart(2, "0");
const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;

/* ============================================================
   Finder: date + time -> student dashboard
   ============================================================ */


/* ============================================================
   Live data counts (one cheap count query per collection)
   ============================================================ */
function countUp(el, to) {
  if (reduce || to < 2 || !("IntersectionObserver" in window)) { el.textContent = to; return; }
  el.textContent = "0";
  const run = () => {
    const t0 = performance.now(), dur = 1600;
    const tick = (now) => {
      const p = Math.min(1, (now - t0) / dur);
      el.textContent = Math.round(to * (1 - Math.pow(1 - p, 3)));
      if (p < 1) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  };
  const io = new IntersectionObserver(([e]) => {
    if (e.isIntersecting) { io.disconnect(); run(); }
  }, { threshold: 0.6 });
  io.observe(el);
}
(async function loadCounts() {
  try {
    const names = ["rooms", "teachers", "timetable"];
    const snaps = await Promise.all(names.map((n) => getCountFromServer(collection(db, n))));
    names.forEach((n, i) =>
      $$(`[data-count="${n}"]`).forEach((el) => countUp(el, snaps[i].data().count)));
  } catch (err) {
    console.warn("Could not load the data counts", err);   // the page keeps its default numbers
  }
})();

/* ============================================================
   Staff sign-in (the Firebase Auth code loads only when needed)
   ============================================================ */
const outView = $("#auth-out");
const inView = $("#auth-in");
const staffBtn = $("#staff-btn");
let authApi = null, auth = null, provider = null;

function setStatus(message, isError) {
  const el = $("#auth-status");
  el.textContent = message || "";
  el.hidden = !message;
  el.classList.toggle("is-error", !!isError);
}
function showSignedOut() { outView.hidden = false; inView.hidden = true; }
function showSignedIn(user) {
  $("#signed-name").textContent = user.displayName || "Staff";
  $("#signed-email").textContent = user.email || "";
  outView.hidden = true;
  inView.hidden = false;
}

async function isOnStaffList(user) {
  const email = String(user.email || "").toLowerCase();
  if (!email) return false;
  const snap = await getDoc(doc(db, "staff", email));
  return snap.exists();
}

async function checkAccount(user) {
  setStatus("Checking your account…");
  try {
    if (await isOnStaffList(user)) { showSignedIn(user); setStatus(""); return; }
    await authApi.signOut(auth);
    showSignedOut();
    setStatus("This account is not on the staff list. You can still use the dashboard as a student.", true);
  } catch (err) {
    console.error(err);
    await authApi.signOut(auth).catch(() => {});
    showSignedOut();
    setStatus(
      err && err.code === "permission-denied"
        ? "Signed in, but the staff list cannot be read yet. The security rules still need the staff update."
        : "Could not check the staff list. Please try again.",
      true
    );
  }
}

async function ensureAuth() {
  if (authApi) return;
  authApi = await import("https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js");
  auth = authApi.getAuth();
  provider = new authApi.GoogleAuthProvider();
  provider.setCustomParameters({ prompt: "select_account" });
  let first = true;
  authApi.onAuthStateChanged(auth, (user) => {      // returning staff who are still signed in
    if (!first) return;
    first = false;
    if (user) checkAccount(user);
  });
}

const SIGN_IN_ERRORS = {
  "auth/popup-blocked": "Your browser blocked the sign-in window. Allow pop-ups for this site and try again.",
  "auth/unauthorized-domain": "This web address is not authorised for sign-in yet. Add it under Authentication, Settings, Authorised domains in Firebase.",
  "auth/operation-not-allowed": "Google sign-in is not turned on in Firebase yet.",
  "auth/network-request-failed": "Network problem. Check your connection and try again."
};

staffBtn.addEventListener("click", async () => {
  setStatus("");
  staffBtn.disabled = true;
  try {
    await ensureAuth();
    const result = await authApi.signInWithPopup(auth, provider);
    await checkAccount(result.user);
  } catch (err) {
    const code = err && err.code;
    if (code === "auth/popup-closed-by-user" || code === "auth/cancelled-popup-request") return;
    console.error(err);
    setStatus(SIGN_IN_ERRORS[code] || "Sign-in failed. Please try again.", true);
  } finally {
    staffBtn.disabled = false;
  }
});

$("#signout-btn").addEventListener("click", async () => {
  await ensureAuth().catch(() => {});
  if (authApi) await authApi.signOut(auth).catch(() => {});
  showSignedOut();
  setStatus("");
});

// Load sign-in code early so the pop-up opens instantly, and detect returning staff.
const preload = () => ensureAuth().catch((e) => console.warn("Auth not loaded", e));
staffBtn.addEventListener("pointerenter", preload, { once: true });
staffBtn.addEventListener("focus", preload, { once: true });
if ("IntersectionObserver" in window) {
  const io = new IntersectionObserver((entries) => {
    if (entries.some((e) => e.isIntersecting)) { preload(); io.disconnect(); }
  }, { rootMargin: "400px" });
  io.observe($("#teachers"));
} else {
  preload();
}
