// staff.js — NoClass teacher dashboard (self-contained). Loaded after app.js.
// Staff sign in with Google; the account must have a document in "staff" (id = lowercase email).
// Teachers post to the "notices" collection. Firestore rules decide who may write.
import { db } from "./firebase-config.js";
import {
  collection, getDocs, getDoc, doc, addDoc, deleteDoc, updateDoc, query, where, orderBy, limit
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
const $ = (id) => document.getElementById(id);
const pad = (n) => String(n).padStart(2, "0");
const esc = (v) => String(v ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
const toMin = (h) => { const [a, b] = String(h).split(":").map(Number); return a * 60 + (b || 0); };
const dayNameOf = (d) => new Date(d + "T00:00:00").toLocaleDateString("en-US", { weekday: "long" });
const prettyDate = (d) => new Date(d + "T00:00:00").toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "short" });
const todayStr = () => { const d = new Date(); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };
const byName = (a, b) => String(a.name || a.roomId).localeCompare(String(b.name || b.roomId), undefined, { numeric: true });

const addDays = (ds, n) => { const d = new Date(ds + "T00:00:00"); d.setDate(d.getDate() + n); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };
const shortDow = (ds) => new Date(ds + "T00:00:00").toLocaleDateString("en-GB", { weekday: "short" });
const fmtMins = (m) => (m >= 60 ? `${Math.floor(m / 60)}h ${m % 60}m` : `${m}m`);
function nextTeaching(from, week) {               // next day (after `from`) on which this teacher has classes
  for (let i = 1; i <= 14; i++) {
    const ds = addDays(from, i), dn = dayNameOf(ds);
    const list = week.filter((e) => e.day === dn).sort((a, b) => toMin(a.startTime) - toMin(b.startTime));
    if (list.length) return { date: ds, list };
  }
  return null;
}
function setDate(ds) {                            // moves the shared date bar
  const i = $("date-input"); if (!i) return;
  i.value = ds;
  i.dispatchEvent(new Event("input", { bubbles: true }));
  i.dispatchEvent(new Event("change", { bubbles: true }));
  render();
}
const NOTICE_TPL = [
  { l: "Cancelled", t: "Class cancelled today. It will be rescheduled.", k: "general" },
  { l: "Quiz", t: "Quiz in the next class. Please revise the last unit.", k: "quiz" },
  { l: "Assignment", t: "Assignment due in the next class. Please submit on time.", k: "assignment" },
  { l: "Lab file", t: "Bring your lab file to the next class.", k: "general" },
  { l: "Extra class", t: "Extra class tomorrow. Check the timing in Updates.", k: "general" },
  { l: "Room changed", t: "Room changed. Please check Updates before coming.", k: "general" }
];
const CANCEL_TPL = [
  { l: "Will be taken Friday", t: "Will be taken on Friday." },
  { l: "Rescheduled", t: "Will be rescheduled. Details soon." },
  { l: "On leave", t: "Teacher on leave today." },
  { l: "Quiz moved", t: "Quiz moved to the next class." }
];
const tplRow = (target, list) => `<div class="td-tpls" role="group" aria-label="Quick messages">${list.map((x) => `<button type="button" class="td-tpl" data-tpl="${esc(x.t)}" data-kind="${x.k || ""}" data-target="${target}">${esc(x.l)}</button>`).join("")}</div>`;
const ROOT = $("screen-dashboard");
let me = null, asCode = null, authApi = null, auth = null, authReady = false, signedEmail = "";
let teachersList = [];

/* ---------- small cache so stepping through times does not re-read Firestore ---------- */
const memo = new Map();
function cached(key, fn, ttl = 600000) {
  const hit = memo.get(key);
  if (hit && Date.now() - hit.t < ttl) return hit.p;
  const p = fn().catch((e) => { memo.delete(key); throw e; });
  memo.set(key, { t: Date.now(), p });
  return p;
}
const rowsOf = (snap) => { const l = []; snap.forEach((d) => l.push({ _id: d.id, ...d.data() })); return l; };
const getRooms = () => cached("rooms", () => getDocs(collection(db, "rooms")).then(rowsOf));
const getTeacherList = () => cached("teachers", () => getDocs(collection(db, "teachers")).then(rowsOf));
const getDay = (day) => cached("day:" + day, () => getDocs(query(collection(db, "timetable"), where("day", "==", day))).then(rowsOf));
const getWeek = (code) => cached("week:" + code, async () => {
  const col = collection(db, "timetable");
  const [a, b] = await Promise.all([
    getDocs(query(col, where("teacherCode", "==", code))),
    getDocs(query(col, where("teacherCodes", "array-contains", code)))
  ]);
  const m = new Map(); rowsOf(a).concat(rowsOf(b)).forEach((e) => m.set(e._id, e));
  return [...m.values()];
});
const getDateNotices = (date) => cached("n:" + date, () => getDocs(query(collection(db, "notices"), where("date", "==", date))).then(rowsOf), 15000);
const getPosts = (code) => cached("p:" + code, () => getDocs(query(collection(db, "notices"), where("teacherCode", "==", code))).then(rowsOf), 15000);

/* ---------- audience helpers ---------- */
const audText = (a) => a ? [a.branch, a.semester ? "Sem " + a.semester : "", a.section ? "Section " + a.section : ""].filter(Boolean).join(" · ") || "All students" : "All students";
const audOptions = (e) => {
  const o = [];
  if (e.section) o.push({ branch: e.branch ?? null, semester: e.semester ?? null, section: e.section });
  o.push({ branch: e.branch ?? null, semester: e.semester ?? null, section: null });
  o.push({ branch: e.branch ?? null, semester: null, section: null });
  return o;
};
const nameFor = (code) => (teachersList.find((t) => t.teacherCode === code) || {}).name || (me && code === me.teacherCode ? me.name : code);

/* ---------- bottom sheet + toast ---------- */
const sheet = document.createElement("div");
sheet.className = "td-back"; sheet.hidden = true;
sheet.innerHTML = `<div class="td-sheet" role="dialog" aria-modal="true" aria-labelledby="td-sheet-title"><div id="td-sheet-body"></div></div>`;
document.body.appendChild(sheet);
const toastEl = document.createElement("div");
toastEl.className = "td-toast"; toastEl.setAttribute("role", "status"); toastEl.hidden = true;
document.body.appendChild(toastEl);
let toastTimer;
function toast(msg) { toastEl.textContent = msg; toastEl.hidden = false; clearTimeout(toastTimer); toastTimer = setTimeout(() => { toastEl.hidden = true; }, 3500); }
function openSheet(html) {
  $("td-sheet-body").innerHTML = html; sheet.hidden = false; document.body.classList.add("td-lock");
  const f = sheet.querySelector("textarea,input:not([type=checkbox]),select,button"); if (f) f.focus();
}
function closeSheet() { sheet.hidden = true; document.body.classList.remove("td-lock"); }
sheet.addEventListener("click", (e) => {
  const b = e.target.closest("[data-tpl]"); if (!b) return;
  const el = $(b.dataset.target); if (el) { el.value = b.dataset.tpl; el.focus(); }
  if (b.dataset.kind && $("sh-kind")) $("sh-kind").value = b.dataset.kind;
});
sheet.addEventListener("click", (e) => { if (e.target === sheet || e.target.closest("[data-act=close]")) closeSheet(); });
document.addEventListener("keydown", (e) => { if (e.key === "Escape" && !sheet.hidden) closeSheet(); });

async function submit(extra, form) {
  const btn = form.querySelector("[type=submit]"), err = form.querySelector(".form-status");
  btn.disabled = true; err.hidden = true;
  const date = extra.date || $("date-input").value;
  try {
    await addDoc(collection(db, "notices"), {
      teacherCode: asCode, teacherName: nameFor(asCode), verified: true, postedBy: me.email,
      date, createdAt: new Date().toISOString(), expiresAt: new Date(`${date}T23:59:59`), ...extra
    });
    memo.delete("n:" + date); memo.delete("p:" + asCode);
    closeSheet(); toast("Posted. Students can see it now."); render();
  } catch (e) {
    console.error(e);
    err.textContent = e.code === "permission-denied" ? "You do not have permission to post this." : "Could not post. Check your connection and try again.";
    err.hidden = false; btn.disabled = false;
  }
}
const audBlock = (opts) => `
  <div class="field"><span class="f-label" id="sh-aud-l">Who can see this</span>
    <div class="seg" id="sh-aud" role="group" aria-labelledby="sh-aud-l">${opts.map((o, i) => `<button type="button" data-i="${i}" aria-pressed="${i === 0}">${i === opts.length - 1 && opts.length > 1 ? "Whole branch" : o.section ? "This section" : "Whole semester"}</button>`).join("")}</div>
    <p class="td-hint" id="sh-aud-text">Visible to ${esc(audText(opts[0]))}</p></div>`;
function wireAud(opts) {
  let sel = 0;
  sheet.querySelectorAll("#sh-aud button").forEach((b) => b.addEventListener("click", () => {
    sel = +b.dataset.i;
    sheet.querySelectorAll("#sh-aud button").forEach((x) => x.setAttribute("aria-pressed", String(x === b)));
    $("sh-aud-text").textContent = "Visible to " + audText(opts[sel]);
  }));
  return () => opts[sel];
}

function openCancel(e, rooms) {
  const opts = audOptions(e), room = (rooms.find((r) => r.roomId === e.roomId) || {}).name || e.roomId;
  openSheet(`<form id="sh-form"><h2 id="td-sheet-title">Cancel ${esc(e.subject || "this class")}?</h2>
    <p class="td-sub">${esc(prettyDate($("date-input").value))} · ${esc(e.startTime)}–${esc(e.endTime)} · ${esc(room)}</p>
    ${audBlock(opts)}
    <div class="field"><label for="sh-note">Note (optional)</label><input id="sh-note" class="input" maxlength="140" placeholder="e.g. Will be taken on Friday"></div>
    <label class="td-switch"><input type="checkbox" id="sh-free" checked><span>Show ${esc(room)} as free for students</span></label>
    <button type="submit" class="btn btn-primary">Cancel class</button>
    <button type="button" class="td-ghost" data-act="close">Keep class</button>
    <p class="form-status is-error" role="alert" hidden></p></form>`);
  const aud = wireAud(opts);
  $("sh-form").addEventListener("submit", (ev) => {
    ev.preventDefault();
    submit({
      type: "cancelled", entryId: e._id, roomId: e.roomId ?? null, subject: e.subject ?? null, startTime: e.startTime, endTime: e.endTime,
      audience: aud(), note: $("sh-note").value.trim(), freeRoom: $("sh-free").checked
    }, ev.target);
  });
}

async function openMove(e, rooms) {
  const day = dayNameOf($("date-input").value), all = await getDay(day), s = toMin(e.startTime), en = toMin(e.endTime);
  const busy = new Set(all.filter((x) => x._id !== e._id && x.roomId && toMin(x.startTime) < en && toMin(x.endTime) > s).map((x) => x.roomId));
  const free = rooms.filter((r) => r.roomId !== e.roomId && !busy.has(r.roomId)).sort((a, b) => (a.isLab ? 1 : 0) - (b.isLab ? 1 : 0) || byName(a, b));
  const opts = audOptions(e);
  openSheet(`<form id="sh-form"><h2 id="td-sheet-title">Change room for ${esc(e.subject || "this class")}</h2>
    <p class="td-sub">${esc(e.startTime)}–${esc(e.endTime)} · only rooms with no class at this time are listed</p>
    ${free.length ? `<div class="field"><label for="sh-room">New room</label><select id="sh-room" class="select">${free.map((r) => `<option value="${esc(r.roomId)}">${esc(r.name || r.roomId)}${r.isLab ? " (lab)" : ""}</option>`).join("")}</select></div>`
      : `<p class="td-hint">No free room at this time.</p>`}
    ${audBlock(opts)}
    <div class="field"><label for="sh-note">Note (optional)</label><input id="sh-note" class="input" maxlength="140" placeholder="e.g. Projector not working in the old room"></div>
    <button type="submit" class="btn btn-primary"${free.length ? "" : " disabled"}>Post room change</button>
    <button type="button" class="td-ghost" data-act="close">Cancel</button>
    <p class="form-status is-error" role="alert" hidden></p></form>`);
  const aud = wireAud(opts);
  $("sh-form").addEventListener("submit", (ev) => {
    ev.preventDefault();
    submit({
      type: "room-changed", entryId: e._id, roomId: e.roomId ?? null, newRoomId: $("sh-room").value, subject: e.subject ?? null,
      startTime: e.startTime, endTime: e.endTime, audience: aud(), note: $("sh-note").value.trim(), freeRoom: true
    }, ev.target);
  });
}

function openNotice(week) {
  const seen = new Map();
  week.forEach((e) => audOptions(e).forEach((a) => seen.set(audText(a), a)));
  const list = [...seen.values()];
  openSheet(`<form id="sh-form"><h2 id="td-sheet-title">Post a notice</h2>
    <p class="td-sub">For example a quiz date, an extra class, or a changed deadline.</p>
    ${tplRow("sh-text", NOTICE_TPL)}
    <div class="field"><label for="sh-text">Notice</label><textarea id="sh-text" class="input" rows="3" maxlength="200" required placeholder="e.g. Unit test on Monday, 10:00 in M303"></textarea></div>
    <div class="field"><label for="sh-kind">Type</label><select id="sh-kind" class="select"><option value="general">General notice</option><option value="quiz">Quiz or test</option><option value="assignment">Assignment deadline</option></select></div>
    <div class="field"><label for="sh-who">Who can see this</label><select id="sh-who" class="select">${list.map((a, i) => `<option value="${i}">${esc(audText(a))}</option>`).join("") || '<option value="-1">All students</option>'}</select></div>
    <button type="submit" class="btn btn-primary">Post notice</button>
    <button type="button" class="td-ghost" data-act="close">Cancel</button>
    <p class="form-status is-error" role="alert" hidden></p></form>`);
  $("sh-form").addEventListener("submit", (ev) => {
    ev.preventDefault();
    const text = $("sh-text").value.trim(); if (!text) return;
    submit({ type: "notice", kind: $("sh-kind").value, entryId: null, roomId: null, subject: null, audience: list[+$("sh-who").value] || null, note: text, freeRoom: false }, ev.target);
  });
}

/* ---------- extra class sheet ---------- */
async function openExtra(preset = {}) {
  const [week, rooms] = await Promise.all([getWeek(asCode), getRooms()]);
  const seen = new Map();
  week.forEach((e) => audOptions(e).forEach((a) => seen.set(audText(a), a)));
  const list = [...seen.values()];
  const date0 = preset.date || $("date-input").value || todayStr(), start0 = preset.start || "10:00";
  const endOf = (s) => { const m = toMin(s) + 60; return `${pad(Math.floor(m / 60) % 24)}:${pad(m % 60)}`; };
  openSheet(`<form id="sh-form"><h2 id="td-sheet-title">Add an extra class</h2>
    <p class="td-sub">Choose a time and we list the rooms that are free then.</p>
    <div class="td-two">
      <div class="field"><label for="x-date">Date</label><input id="x-date" type="date" class="input" min="${todayStr()}" value="${esc(date0)}" required></div>
      <div class="field"><label for="x-s">From</label><input id="x-s" type="time" class="input" value="${esc(start0)}" required></div>
      <div class="field"><label for="x-e">To</label><input id="x-e" type="time" class="input" value="${endOf(start0)}" required></div>
    </div>
    <div class="field"><label for="x-room">Room</label><select id="x-room" class="select"></select></div>
    <div class="field"><label for="x-sub">Subject</label><input id="x-sub" class="input" maxlength="60" placeholder="e.g. Machine Learning, extra class"></div>
    <div class="field"><label for="x-who">Who can see this</label><select id="x-who" class="select">${list.map((a, i) => `<option value="${i}">${esc(audText(a))}</option>`).join("") || '<option value="-1">All students</option>'}</select></div>
    ${tplRow("sh-note", CANCEL_TPL)}
    <div class="field"><label for="sh-note">Note (optional)</label><input id="sh-note" class="input" maxlength="140" placeholder="e.g. Bring your laptops"></div>
    <button type="submit" class="btn btn-primary">Post extra class</button>
    <button type="button" class="td-ghost" data-act="close">Cancel</button>
    <p class="form-status is-error" role="alert" hidden></p></form>`);
  const refresh = async () => {
    const d = $("x-date").value, sv = $("x-s").value, ev = $("x-e").value, sel = $("x-room");
    if (!d || !sv || !ev || toMin(ev) <= toMin(sv)) { sel.innerHTML = '<option value="">Choose a valid time</option>'; return; }
    const s = toMin(sv), e = toMin(ev), clash = (x) => toMin(x.startTime) < e && toMin(x.endTime) > s;
    const [all, notes] = await Promise.all([getDay(dayNameOf(d)), getDateNotices(d)]);
    const busy = new Set(all.filter((x) => x.roomId && clash(x)).map((x) => x.roomId));
    notes.filter((n) => n.type === "extra" && n.roomId && n.startTime && clash(n)).forEach((n) => busy.add(n.roomId));
    notes.filter((n) => n.type === "room-changed" && n.newRoomId && n.startTime && clash(n)).forEach((n) => busy.add(n.newRoomId));
    const free = rooms.filter((r) => !busy.has(r.roomId)).sort((a, b) => (a.isLab ? 1 : 0) - (b.isLab ? 1 : 0) || byName(a, b));
    sel.innerHTML = free.length ? free.map((r) => `<option value="${esc(r.roomId)}">${esc(r.name || r.roomId)}${r.isLab ? " (lab)" : ""}</option>`).join("") : '<option value="">No free room at this time</option>';
    if (preset.roomId && free.some((r) => r.roomId === preset.roomId)) sel.value = preset.roomId;
  };
  ["x-date", "x-s", "x-e"].forEach((id) => $(id).addEventListener("change", refresh));
  refresh();
  $("sh-form").addEventListener("submit", (ev) => {
    ev.preventDefault();
    const d = $("x-date").value, s = $("x-s").value, e = $("x-e").value, room = $("x-room").value, err = ev.target.querySelector(".form-status");
    const bad = !room ? "Choose a free room." : toMin(e) <= toMin(s) ? "The end time must be after the start time." : d < todayStr() ? "Pick today or a future date." : "";
    if (bad) { err.textContent = bad; err.hidden = false; return; }
    submit({
      type: "extra", date: d, entryId: null, roomId: room, startTime: s, endTime: e, subject: $("x-sub").value.trim() || "Extra class",
      audience: list[+$("x-who").value] || null, note: $("sh-note").value.trim(), freeRoom: false
    }, ev.target);
  });
}

/* ---------- dashboard screen ---------- */
const TYPE_LABEL = { cancelled: "Class cancelled", "room-changed": "Room changed", extra: "Extra class", notice: "Notice" };
const KIND_LABEL = { quiz: "Quiz or test", assignment: "Assignment due" };
let token = 0;
async function render() {
  if (location.hash !== "#dashboard") return;
  const tk = ++token;
  if (!authReady) { ROOT.innerHTML = gate("Checking your account…"); return; }
  if (!me) {
    ROOT.innerHTML = gate(signedEmail ? `${esc(signedEmail)} is not on the staff list.` : "Teachers sign in with their institute Google account.", true);
    return;
  }
  const date = $("date-input").value, time = $("time-input").value;
  if (!date || !time) return;
  const code = asCode, day = dayNameOf(date), isAdmin = me.role === "admin";
  // future date: never done. past date: always done. today: the REAL clock, not the time bar
  const nowD = new Date();
  const t = date > todayStr() ? -1 : date < todayStr() ? 1441 : nowD.getHours() * 60 + nowD.getMinutes(); try {
    const [rooms, week, dayNotices, posts, tList] = await Promise.all([getRooms(), getWeek(code), getDateNotices(date), getPosts(code), isAdmin ? getTeacherList() : []]);
    if (tk !== token) return;
    if (isAdmin) teachersList = tList;
    const roomName = (id) => (rooms.find((r) => r.roomId === id) || {}).name || id || "Room not listed";
    const classes = week.filter((e) => e.day === day).sort((a, b) => toMin(a.startTime) - toMin(b.startTime));
    const hit = new Map(); dayNotices.filter((n) => n.entryId && (n.type === "cancelled" || n.type === "room-changed")).forEach((n) => hit.set(n.entryId, n));
    const locked = date < todayStr();
    const canUndo = (n) => n.teacherCode === code || isAdmin;
    const hr = new Date().getHours(), hello = hr < 12 ? "Good morning" : hr < 17 ? "Good afternoon" : "Good evening";
    const who = nameFor(code);

    const classItems = classes.map((e, i) => {
      const n = hit.get(e._id), cancelled = n && n.type === "cancelled", moved = n && n.type === "room-changed";
      const s = toMin(e.startTime), en = toMin(e.endTime);
      let tone, state;
      if (cancelled) { tone = "off"; state = "Cancelled · visible to " + audText(n.audience); }
      else if (t >= en) { tone = "done"; state = "Done"; }
      else if (t >= s) { tone = "live"; state = "In progress"; }
      else { tone = "soon"; state = "Starts at " + e.startTime; }
      const others = (Array.isArray(e.teachers) ? e.teachers : []).filter((x) => x !== who);
      const room = moved ? `${esc(roomName(n.newRoomId))} <span class="td-from">moved from ${esc(roomName(e.roomId))}</span>` : esc(roomName(e.roomId));
      let acts = "";
      if (!locked) {
        if (n) acts = canUndo(n) ? `<button type="button" class="td-btn" data-act="undo" data-id="${esc(n._id)}">${cancelled ? "Undo cancel" : "Undo room change"}</button>` : "";
        else if (t < en) acts = `<button type="button" class="td-btn danger" data-act="cancel" data-e="${esc(e._id)}">Cancel class</button><button type="button" class="td-btn" data-act="move" data-e="${esc(e._id)}">Change room</button>`;
      }
      return {
        s, html: `<li class="td-card is-${tone}" style="--i:${i}">
        <div class="td-top"><span class="td-time">${esc(e.startTime)}–${esc(e.endTime)}</span><span class="td-state"><span class="td-dot"></span>${esc(state)}</span></div>
        <p class="td-subject">${esc(e.subject || "Subject not listed")}${e.isLab ? '<span class="td-chip">Lab</span>' : ""}</p>
        <p class="td-meta">${esc(audText({ branch: e.branch, semester: e.semester, section: e.section }))} · ${room}${others.length ? ` · with ${esc(others.join(", "))}` : ""}</p>
        ${n && n.note ? `<p class="td-note">“${esc(n.note)}”</p>` : ""}
        ${acts ? `<div class="td-actions">${acts}</div>` : ""}</li>`
      };
    });
    const extraItems = dayNotices.filter((n) => n.type === "extra" && n.teacherCode === code).map((n, i) => ({
      s: toMin(n.startTime), html: `<li class="td-card is-soon" style="--i:${i}">
        <div class="td-top"><span class="td-time">${esc(n.startTime)}–${esc(n.endTime)}</span><span class="td-state"><span class="td-dot"></span>Extra class</span></div>
        <p class="td-subject">${esc(n.subject || "Extra class")}<span class="td-chip">Extra</span></p>
        <p class="td-meta">${esc(audText(n.audience))} · ${esc(roomName(n.roomId))}</p>
        ${n.note ? `<p class="td-note">“${esc(n.note)}”</p>` : ""}
        ${locked ? "" : `<div class="td-actions"><button type="button" class="td-btn" data-act="undo" data-id="${esc(n._id)}">Delete</button></div>`}</li>`
    }));
    const todayS = todayStr();
    const nt = nextTeaching(date < todayS ? addDays(todayS, -1) : date, week);
    const cards = classItems.concat(extraItems).sort((a, b) => a.s - b.s).map((x) => x.html).join("")
      || `<li class="td-empty"><strong>No classes on ${esc(day)}</strong><span>${nt ? `Next: ${esc(prettyDate(nt.date))} · ${nt.list.length} ${nt.list.length === 1 ? "class" : "classes"}` : "Pick another date from the bar above."}</span>${nt ? `<button type="button" class="td-btn primary" data-act="goto" data-date="${nt.date}">Go to ${esc(dayNameOf(nt.date))}</button>` : ""}</li>`;

    const mine = posts.filter((p) => p.date >= todayStr()).sort((a, b) => String(a.date).localeCompare(String(b.date)) || String(b.createdAt).localeCompare(String(a.createdAt)));
    const postRows = mine.map((p) => `<li class="td-post">
        <div><p class="td-post-t">${esc(p.type === "notice" ? (KIND_LABEL[p.kind] || "Notice") : (TYPE_LABEL[p.type] || p.type))}${p.subject ? " · " + esc(p.subject) : ""}</p>
        <p class="td-meta">${esc(prettyDate(p.date))} · ${esc(audText(p.audience))}</p>${p.note ? `<p class="td-note">“${esc(p.note)}”</p>` : ""}</div>
        <button type="button" class="td-btn" data-act="undo" data-id="${esc(p._id)}" aria-label="Delete this post">Delete</button></li>`).join("")
      || `<li class="td-empty"><strong>No upcoming posts</strong><span>Cancellations and notices you post will appear here.</span></li>`;

    // ---------- week rail, stat tiles, next class plate ----------
    const d0 = new Date(date + "T00:00:00"), off = d0.getDay() === 0 ? -1 : d0.getDay() - 1;
    const weekHtml = `<nav class="sk-week" aria-label="Choose a day">${[0, 1, 2, 3, 4, 5].map((k) => {
      const ds = addDays(date, k - off), n = week.filter((e) => e.day === dayNameOf(ds)).length;
      return `<button type="button" class="sk-key${ds === date ? " is-on" : ""}${ds === todayS ? " is-today" : ""}${ds < todayS ? " is-past" : ""}" data-act="goto" data-date="${ds}" aria-pressed="${ds === date}">
        <span class="sk-dow">${esc(shortDow(ds))}</span><span class="sk-dnum">${+ds.slice(8)}</span>
        <span class="sk-cnt">${n ? `<b>${n}</b><em> ${n === 1 ? "class" : "classes"}</em>` : "Off"}</span></button>`;
    }).join("")}</nav>`;

    const isCancelled = (e) => { const n = hit.get(e._id); return !!n && n.type === "cancelled"; };
    const cancelledN = classes.filter(isCancelled).length;
    const movedN = classes.filter((e) => { const n = hit.get(e._id); return n && n.type === "room-changed"; }).length;
    const stat = (tone, label, num) => `<div class="sk-stat" data-tone="${tone}"><span class="sk-lab"><i class="sk-led"></i>${label}</span><span class="sk-num">${num}</span></div>`;
    const statsHtml = `<div class="sk-stats">${stat("free", "Classes", classes.length + extraItems.length)}${stat("off", "Cancelled", cancelledN)}${stat("warn", "Room changes", movedN)}${stat("acc", "Active posts", mine.length)}</div>`;

    let nextHtml = "";
    const nxt = classes.find((e) => !isCancelled(e) && t < toMin(e.endTime));
    if (nxt) {
      const s = toMin(nxt.startTime), en = toMin(nxt.endTime), liveNow = t >= s, isToday = date === todayS;
      const n = hit.get(nxt._id), moved = n && n.type === "room-changed";
      const lcd = liveNow ? `LIVE · ends in ${fmtMins(en - t)}` : isToday ? `Starts in ${fmtMins(s - t)}` : `Starts at ${nxt.startTime}`;
      const pct = liveNow ? Math.min(100, Math.max(0, Math.round(((t - s) / (en - s)) * 100))) : 0;
      const room = moved ? roomName(n.newRoomId) : roomName(nxt.roomId);
      const acts = locked ? "" : n ? (canUndo(n) ? `<button type="button" class="td-btn" data-act="undo" data-id="${esc(n._id)}">Undo room change</button>` : "")
        : `<button type="button" class="td-btn danger" data-act="cancel" data-e="${esc(nxt._id)}">Cancel class</button><button type="button" class="td-btn" data-act="move" data-e="${esc(nxt._id)}">Change room</button>`;
      nextHtml = `<section class="sk-next${liveNow ? " is-live" : ""}" aria-label="Next class">
        <div class="sk-next-main"><span class="sk-eng">${liveNow ? "Happening now" : "Next class"}</span>
          <h2 class="sk-next-t">${esc(nxt.subject || "Subject not listed")}${nxt.isLab ? '<span class="td-chip">Lab</span>' : ""}</h2>
          <p class="td-meta">${esc(nxt.startTime)}–${esc(nxt.endTime)} · ${esc(audText({ branch: nxt.branch, semester: nxt.semester, section: nxt.section }))} · ${esc(room)}${moved ? ' <span class="td-from">(moved)</span>' : ""}</p>
          ${acts ? `<div class="td-actions">${acts}</div>` : ""}</div>
        <div class="sk-lcd"><span class="sk-lcd-t">${esc(lcd)}</span>${liveNow ? `<span class="sk-groove"><i style="width:${pct}%"></i></span>` : ""}</div></section>`;
    } else if (nt) {
      const f = nt.list[0];
      nextHtml = `<section class="sk-next is-idle" aria-label="Next class">
        <div class="sk-next-main"><span class="sk-eng">${classes.length ? "Done for the day" : "No classes this day"}</span>
          <h2 class="sk-next-t">Next: ${esc(dayNameOf(nt.date))}</h2>
          <p class="td-meta">${esc(f.startTime)} · ${esc(f.subject || "Subject not listed")} · ${nt.list.length} ${nt.list.length === 1 ? "class" : "classes"}</p>
          <div class="td-actions"><button type="button" class="td-btn primary" data-act="goto" data-date="${nt.date}">Open ${esc(dayNameOf(nt.date))}</button></div></div>
        <div class="sk-lcd"><span class="sk-lcd-t">${esc(prettyDate(nt.date))}</span></div></section>`;
    }
    const proHtml = `<div class="td-sk">${weekHtml}${statsHtml}${nextHtml}</div>`;

    ROOT.innerHTML = `
      <header class="page-head td-head">
        <div><h1 class="page-title">Dashboard.</h1>
        <p class="page-sub">${hello}, ${esc(who)} · ${esc(prettyDate(date))}</p></div>
        <div class="td-who"><span class="td-badge">${isAdmin ? "Admin" : "Verified teacher"}</span>
        <button type="button" class="td-btn" data-act="signout">Sign out</button></div>
      </header>
      ${isAdmin ? `<label class="td-viewas">View as <select id="td-as" class="select select-inline">${[{ teacherCode: me.teacherCode, name: me.name + " (you)" }].concat(tList.filter((x) => x.teacherCode !== me.teacherCode).sort(byName)).map((x) => `<option value="${esc(x.teacherCode)}"${x.teacherCode === code ? " selected" : ""}>${esc(x.name)} · ${esc(x.teacherCode)}</option>`).join("")}</select></label>` : ""}
            ${proHtml}
      <div class="split split-even">
        <section class="panel"><div class="panel-head"><h2>Classes on ${esc(day)}</h2></div><ul class="td-list">${cards}</ul></section>
        <section class="panel"><div class="panel-head"><h2>My posts</h2><div class="td-btns"><button type="button" class="td-btn" data-act="extra">+ Extra class</button><button type="button" class="td-btn primary" data-act="notice">+ Post notice</button></div></div><ul class="td-list">${postRows}</ul></section>
      </div>`;
    ROOT._ctx = { week, rooms };
    if (isAdmin) ROOT.insertAdjacentHTML("beforeend", modShell());
  } catch (err) {
    if (tk !== token) return;
    console.error(err);
    ROOT.innerHTML = gate("Could not load the dashboard. Check your connection and try again.");
  }
}
function gate(msg, link) {
  return `<header class="page-head"><h1 class="page-title">Dashboard.</h1></header>
    <section class="panel td-gate"><p>${msg}</p>${link ? '<a class="btn btn-primary" href="index.html#teachers">Staff sign in</a>' : ""}</section>`;
}

ROOT.addEventListener("click", async (ev) => {
  const b = ev.target.closest("[data-act]"); if (!b) return;
  const act = b.dataset.act, ctx = ROOT._ctx || {};
  const entry = () => (ctx.week || []).find((e) => e._id === b.dataset.e);
  if (act === "cancel" && entry()) openCancel(entry(), ctx.rooms || []);
  else if (act === "move" && entry()) openMove(entry(), ctx.rooms || []);
  else if (act === "notice") openNotice(ctx.week || []);
  else if (act === "extra") openExtra();
  else if (act === "goto") setDate(b.dataset.date);
  else if (act === "signout") { if (authApi) await authApi.signOut(auth); location.hash = "#rooms"; }
  else if (act === "mod-load") modLoad(b.dataset.col);
  else if (act === "mod-del") {
    if (!confirm("Delete this post for everyone?")) return;
    b.disabled = true;
    try { await deleteDoc(doc(db, b.dataset.col, b.dataset.id)); b.closest("li").remove(); toast("Deleted."); }
    catch (e) { console.error(e); b.disabled = false; toast("Could not delete."); }
  }
  else if (act === "mod-clear") {
    b.disabled = true;
    try { await updateDoc(doc(db, b.dataset.col, b.dataset.id), { flagCount: 0 }); toast("Flags dismissed."); modLoad(b.dataset.col); }
    catch (e) { console.error(e); b.disabled = false; toast("Could not update."); }
  }
  else if (act === "undo") {
    b.disabled = true;
    try { await deleteDoc(doc(db, "notices", b.dataset.id)); memo.clear(); toast("Removed."); render(); }
    catch (e) { console.error(e); b.disabled = false; toast("Could not remove it."); }
  }
});
// "Use for extra class" button on a room tile (shown to staff only)
document.addEventListener("click", (e) => {
  const b = e.target.closest("[data-extra-room]");
  if (!b || !me) return;
  location.hash = "#dashboard";
  openExtra({ roomId: b.dataset.extraRoom, date: $("date-input").value, start: $("time-input").value });
});
ROOT.addEventListener("change", (ev) => { if (ev.target.id === "td-as") { asCode = ev.target.value; render(); } });

/* ---------- sign-in state, sidebar link, live updates ---------- */
const staffLink = document.querySelector('#sidebar a[href="index.html#teachers"]'); const staffLabel = staffLink ? staffLink.querySelector("span") : null;
const staffLabelText = staffLabel ? staffLabel.textContent : "";
function applyNav() {
  const item = $("nav-dashboard"); if (item) item.hidden = !me;
  document.body.classList.toggle("is-staff", !!me);          // shows staff-only buttons elsewhere in the app
  document.body.dataset.staffCode = me ? me.teacherCode : "";
  window.dispatchEvent(new Event("noclass:staff"));
  if (staffLink) {
    if (staffLabel) staffLabel.textContent = me ? (me.name || "Staff").replace(/^(Dr|Mr|Mrs|Ms|Prof)\.?\s+/i, "").split(" ").slice(0, 2).join(" ") : staffLabelText;
    staffLink.title = me ? "Dashboard" : "Staff sign-in"; staffLink.setAttribute("href", me ? "#dashboard" : "index.html#teachers");
  }
}
const modShell = () => `<section class="panel td-mod" id="td-mod" aria-labelledby="td-mod-t">
  <div class="panel-head"><h2 id="td-mod-t">Moderation</h2>
    <div class="td-btns"><button type="button" class="td-btn" data-act="mod-load" data-col="reports">Reports</button>
    <button type="button" class="td-btn" data-act="mod-load" data-col="lostFound">Lost &amp; Found</button></div></div>
  <p class="td-hint">Newest 50 posts, flagged ones first. Posts with 3 or more flags are hidden from students until you dismiss the flags or delete them.</p>
  <ul class="td-list" id="td-mod-list"></ul></section>`;

async function modLoad(col) {
  const list = $("td-mod-list"); if (!list) return;
  list.innerHTML = `<li class="td-empty">Loading…</li>`;
  try {
    const snap = await getDocs(query(collection(db, col), orderBy("createdAt", "desc"), limit(50)));
    const rows = []; snap.forEach((d) => rows.push({ id: d.id, ...d.data() }));
    rows.sort((a, b) => (b.flagCount || 0) - (a.flagCount || 0));
    const when = (s) => { const d = new Date(s); return isNaN(d) ? "" : d.toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }); };
    list.innerHTML = rows.length ? rows.map((r) => `<li class="td-post"><div>
        <p class="td-post-t">${esc(r.type || "post")} · ${esc(r.roomId || "")}${r.flagCount ? ` <span class="td-flag">${r.flagCount} flag${r.flagCount > 1 ? "s" : ""}</span>` : ""}</p>
        <p class="td-note">${esc(col === "reports" ? (r.note || "(no note)") : r.description)}</p>
        <p class="td-hint">${esc(r.date || "")} ${esc(when(r.createdAt))}</p></div>
        <div class="td-btns">${r.flagCount ? `<button type="button" class="td-btn" data-act="mod-clear" data-col="${col}" data-id="${esc(r.id)}">Dismiss flags</button>` : ""}
        <button type="button" class="td-btn danger" data-act="mod-del" data-col="${col}" data-id="${esc(r.id)}">Delete</button></div></li>`).join("")
      : `<li class="td-empty"><strong>Nothing here</strong></li>`;
  } catch (e) { console.error(e); list.innerHTML = `<li class="td-empty">Could not load.</li>`; }
}
async function startAuth() {
  try {
    authApi = await import("https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js");
    auth = authApi.getAuth();
    authApi.onAuthStateChanged(auth, async (user) => {
      me = null; signedEmail = user && user.email ? user.email : "";
      if (signedEmail) {
        try {
          const s = await getDoc(doc(db, "staff", signedEmail.toLowerCase()));
          if (s.exists()) me = { email: signedEmail.toLowerCase(), ...s.data() };
        } catch (e) { console.warn("Staff check failed", e); }
      }
      asCode = me ? me.teacherCode : null; authReady = true;
      applyNav(); render();
    });
  } catch (e) { console.warn("Staff sign-in unavailable", e); authReady = true; render(); }
}
// refresh statuses every minute while the dashboard is open
setInterval(() => { if (location.hash === "#dashboard" && !document.hidden && sheet.hidden) render(); }, 60000);
window.addEventListener("hashchange", render);
new MutationObserver(render).observe($("when-text"), { childList: true, characterData: true, subtree: true });
render();
// Students never sign in, so load the sign-in code when the browser is idle (or at once on the dashboard).
if (location.hash === "#dashboard") startAuth();
else (window.requestIdleCallback || ((f) => setTimeout(f, 1200)))(startAuth);