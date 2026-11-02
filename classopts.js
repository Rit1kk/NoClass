// classopts.js — "my class" (saved on the student's device) + the class list. Shared by the home page and the app.
import { db } from "./firebase-config.js";
import { collection, getDocs, query, where } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

const KEY = "noclass-myclass", OPT_KEY = "noclass-classopts-v1", DAY = 864e5;
export const esc = (v) => String(v ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
export const same = (a, b) => String(a ?? "") === String(b ?? "");

/* ---------- the student's class ---------- */
export function getMyClass() {
  try { const v = JSON.parse(localStorage.getItem(KEY)); return v && v.branch ? v : null; } catch (_) { return null; }
}
export function setMyClass(v) {
  const c = v && v.branch ? { branch: String(v.branch), semester: v.semester ? String(v.semester) : "", section: v.section ? String(v.section) : "" } : null;
  try { c ? localStorage.setItem(KEY, JSON.stringify(c)) : localStorage.removeItem(KEY); } catch (_) { /* private mode */ }
  window.dispatchEvent(new CustomEvent("noclass:myclass", { detail: c }));
}
export const classLabel = (c) => c ? [c.branch, c.semester ? "Sem " + c.semester : "", c.section ? "Section " + c.section : ""].filter(Boolean).join(" · ") : "";
// A timetable entry belongs to the class (an empty semester or section means "any").
export const matches = (c, e) => !!c && same(c.branch, e.branch) && (!c.semester || same(c.semester, e.semester)) && (!c.section || same(c.section, e.section));
// A teacher notice is for the class (a notice with no semester or section is for everyone in the branch).
export function audienceMatches(c, a) {
  if (!c || !a) return true;
  const ok = (mine, theirs) => !mine || !theirs || same(mine, theirs);
  return ok(c.branch, a.branch) && ok(c.semester, a.semester) && ok(c.section, a.section);
}

/* ---------- small local cache so students do not re-read Firestore ---------- */
const readCache = (key, ttl) => { try { const v = JSON.parse(localStorage.getItem(key)); if (v && Date.now() - v.t < ttl) return v.d; } catch (_) { /* ignore */ } return null; };
const writeCache = (key, d) => { try { localStorage.setItem(key, JSON.stringify({ t: Date.now(), d })); } catch (_) { /* ignore */ } };
const rows = (snap) => { const l = []; snap.forEach((d) => l.push({ _id: d.id, ...d.data() })); return l; };

// Every branch / semester / section found in the timetable (3 weekdays are enough). Kept 7 days on the device.
let optsP = null;
export function getClassOptions() {
  if (optsP) return optsP;
  const hit = readCache(OPT_KEY, 7 * DAY);
  if (hit) return (optsP = Promise.resolve(hit));
  optsP = getDocs(query(collection(db, "timetable"), where("day", "in", ["Monday", "Wednesday", "Friday"]))).then((snap) => {
    const seen = new Map();
    snap.forEach((d) => {
      const e = d.data();
      if (!e.branch || e.semester === undefined || e.semester === null) return;
      seen.set(`${e.branch}|${e.semester}|${e.section ?? ""}`, { branch: String(e.branch), semester: String(e.semester), section: e.section ? String(e.section) : "" });
    });
    const list = [...seen.values()];
    if (list.length) writeCache(OPT_KEY, list);
    return list;
  }).catch((e) => { optsP = null; throw e; });
  return optsP;
}

// The whole week for one branch (used for "My class" and "your teachers"). Kept 24 hours on the device.
const branchMem = new Map();
export function getBranchEntries(branch) {
  if (branchMem.has(branch)) return branchMem.get(branch);
  const key = "noclass-branch-" + branch, hit = readCache(key, DAY);
  const p = (hit ? Promise.resolve(hit) : getDocs(query(collection(db, "timetable"), where("branch", "==", branch))).then((s) => { const l = rows(s); writeCache(key, l); return l; }))
    .catch((e) => { branchMem.delete(branch); throw e; });
  branchMem.set(branch, p);
  return p;
}
let roomsP = null;
export const getRooms = () => roomsP || (roomsP = getDocs(collection(db, "rooms")).then(rows).catch((e) => { roomsP = null; throw e; }));
const noticeMem = new Map();
export function getNotices(date) {
  const hit = noticeMem.get(date);
  if (hit && Date.now() - hit.t < 30000) return hit.p;
  const p = getDocs(query(collection(db, "notices"), where("date", "==", date))).then(rows).catch(() => []);
  noticeMem.set(date, { t: Date.now(), p });
  return p;
}

/* ---------- the three dropdowns (used on the home page and in the app) ---------- */
export async function renderPicker(root, onChange = () => {}) {
  root.innerHTML = `<p class="cp-hint">Loading classes…</p>`;
  let list;
  try { list = await getClassOptions(); } catch (_) { list = []; }
  if (!list.length) { root.innerHTML = `<p class="cp-hint">Could not load the class list. Check your connection and reload.</p>`; return { value: () => null }; }
  const cur = getMyClass() || {};
  root.innerHTML = `<div class="cp-row">
    <label class="cp-f"><span>Branch</span><select class="cp-b"></select></label>
    <label class="cp-f"><span>Semester</span><select class="cp-s"></select></label>
    <label class="cp-f"><span>Section</span><select class="cp-c"></select></label></div>`;
  const [b, s, c] = [".cp-b", ".cp-s", ".cp-c"].map((q) => root.querySelector(q));
  const uniq = (a) => [...new Set(a)].sort((x, y) => String(x).localeCompare(String(y), undefined, { numeric: true }));
  const fill = (sel, vals, pick, ph, label = (v) => v) => {
    sel.innerHTML = `<option value="">${ph}</option>` + vals.map((v) => `<option value="${esc(v)}"${same(v, pick) ? " selected" : ""}>${esc(label(v))}</option>`).join("");
    sel.disabled = !vals.length;
  };
  const ok = () => onChange(!!(b.value && s.value));
  const draw = (pick) => {
    fill(b, uniq(list.map((x) => x.branch)), pick.branch, "Choose branch");
    fill(s, uniq(list.filter((x) => same(x.branch, b.value)).map((x) => x.semester)), pick.semester, "Choose semester", (v) => "Semester " + v);
    fill(c, uniq(list.filter((x) => same(x.branch, b.value) && same(x.semester, s.value) && x.section).map((x) => x.section)), pick.section, "All sections", (v) => "Section " + v);
    ok();
  };
  draw(cur);
  b.addEventListener("change", () => draw({ branch: b.value }));
  s.addEventListener("change", () => draw({ branch: b.value, semester: s.value }));
  c.addEventListener("change", ok);
  return { value: () => (b.value && s.value ? { branch: b.value, semester: s.value, section: c.value } : null) };
}
