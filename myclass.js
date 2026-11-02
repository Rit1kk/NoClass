// myclass.js — the student's class: header pill, class picker sheet, and the "My class" screen. Loaded after app.js.
import { getMyClass, setMyClass, classLabel, matches, audienceMatches, getBranchEntries, getNotices, getRooms, renderPicker, esc } from "./classopts.js";

const $ = (id) => document.getElementById(id);
const pad = (n) => String(n).padStart(2, "0");
const toMin = (h) => { const [a, b] = String(h).split(":").map(Number); return a * 60 + (b || 0); };
const dayNameOf = (d) => new Date(d + "T00:00:00").toLocaleDateString("en-US", { weekday: "long" });
const prettyDate = (d) => new Date(d + "T00:00:00").toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "short" });
const ROOT = $("screen-myclass");
const CAP = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 4 3 8.5l9 4.5 9-4.5L12 4z"/><path d="M7 11v4.2c0 1.2 2.2 2.8 5 2.8s5-1.6 5-2.8V11"/></svg>';
const KIND = { quiz: "Quiz or test", assignment: "Assignment due" };

/* ---------- header pill ---------- */
const pill = document.createElement("button");
pill.type = "button"; pill.id = "class-pill"; pill.className = "class-pill";
const inner = document.querySelector(".when-inner");
if (inner) inner.appendChild(pill);
function paintPill() {
  const c = getMyClass();
  pill.classList.toggle("is-empty", !c);
  pill.innerHTML = CAP + `<span>${c ? esc(classLabel(c)) : "Choose your class"}</span>`;
  pill.setAttribute("aria-label", c ? `Your class: ${classLabel(c)}. Change class` : "Choose your class");
}
pill.addEventListener("click", () => openClassSheet());

/* ---------- picker sheet ---------- */
const sheet = document.createElement("div");
sheet.className = "td-back"; sheet.hidden = true;
sheet.innerHTML = `<div class="td-sheet" role="dialog" aria-modal="true" aria-labelledby="cp-sheet-title"><div id="cp-sheet-body"></div></div>`;
document.body.appendChild(sheet);
function closeSheet() { sheet.hidden = true; $("cp-sheet-body").innerHTML = ""; document.body.classList.remove("td-lock"); }
sheet.addEventListener("click", (e) => { if (e.target === sheet || e.target.closest("[data-act=close]")) closeSheet(); });
document.addEventListener("keydown", (e) => { if (e.key === "Escape" && !sheet.hidden) closeSheet(); });
async function openClassSheet() {
  $("cp-sheet-body").innerHTML = `<form id="cp-form"><h2 id="cp-sheet-title">Choose your class</h2>
    <p class="td-sub">We show your timetable, your teachers and updates for your class first. It is saved on this device only.</p>
    <div id="cp-mount"></div>
    <button type="submit" class="btn btn-primary" disabled>Save my class</button>
    ${getMyClass() ? '<button type="button" class="td-ghost" id="cp-clear">Remove my class</button>' : ""}
    <button type="button" class="td-ghost" data-act="close">Cancel</button></form>`;
  sheet.hidden = false; document.body.classList.add("td-lock");
  const form = $("cp-form"), save = form.querySelector("[type=submit]");
  const pick = await renderPicker($("cp-mount"), (ok) => { save.disabled = !ok; });
  form.addEventListener("submit", (e) => { e.preventDefault(); const v = pick.value(); if (v) { setMyClass(v); closeSheet(); } });
  const clr = $("cp-clear"); if (clr) clr.addEventListener("click", () => { setMyClass(null); closeSheet(); });
}

/* ---------- the "My class" screen ---------- */
let token = 0;
async function render() {
  if (location.hash !== "#myclass") return;
  const tk = ++token, c = getMyClass();
  if (!c) {
    ROOT.innerHTML = `<header class="page-head"><h1 class="page-title">My class.</h1>
      <p class="page-sub">Choose your class to see your timetable, your teachers and updates first.</p></header>
      <section class="panel cp-inline"><div id="cp-inline"></div><button type="button" id="cp-inline-save" class="btn btn-primary" disabled>Save my class</button></section>`;
    const pick = await renderPicker($("cp-inline"), (ok) => { const b = $("cp-inline-save"); if (b) b.disabled = !ok; });
    const b = $("cp-inline-save"); if (b) b.addEventListener("click", () => { const v = pick.value(); if (v) setMyClass(v); });
    return;
  }
  const date = $("date-input").value, time = $("time-input").value;
  if (!date || !time) return;
  const day = dayNameOf(date), t = toMin(time);
  try {
    const [all, notices, rooms] = await Promise.all([getBranchEntries(c.branch), getNotices(date), getRooms()]);
    if (tk !== token) return;
    const roomName = (id) => (rooms.find((r) => r.roomId === id) || {}).name || id || "Room not listed";
    const mine = all.filter((e) => matches(c, e));
    const hit = new Map();
    notices.filter((n) => n.entryId && (n.type === "cancelled" || n.type === "room-changed")).forEach((n) => hit.set(n.entryId, n));
    const forMe = notices.filter((n) => audienceMatches(c, n.audience));
    const teachersOf = (e) => (Array.isArray(e.teachers) && e.teachers.length ? e.teachers : e.teacher ? [e.teacher] : []);

    const items = mine.filter((e) => e.day === day).map((e) => ({ s: toMin(e.startTime), e }))
      .concat(forMe.filter((n) => n.type === "extra" && n.startTime).map((n) => ({ s: toMin(n.startTime), n })))
      .sort((a, b) => a.s - b.s);
    const cards = items.map((it, i) => {
      const x = it.e || { startTime: it.n.startTime, endTime: it.n.endTime, subject: it.n.subject || "Extra class", roomId: it.n.roomId, teachers: [it.n.teacherName] };
      const n = it.e ? hit.get(it.e._id) : null, off = n && n.type === "cancelled", moved = n && n.type === "room-changed";
      const s = toMin(x.startTime), en = toMin(x.endTime);
      let tone, state;
      if (off) { tone = "off"; state = "Cancelled"; }
      else if (t >= en) { tone = "done"; state = "Done"; }
      else if (t >= s) { tone = "live"; state = "In progress"; }
      else { tone = "soon"; state = "Starts at " + x.startTime; }
      const room = moved ? `${esc(roomName(n.newRoomId))} <span class="td-from">moved from ${esc(roomName(x.roomId))}</span>` : esc(roomName(x.roomId));
      const who = teachersOf(x).join(", ");
      const tag = it.n ? '<span class="td-chip">Extra class</span>' : x.isLab ? '<span class="td-chip">Lab</span>' : "";
      return `<li class="td-card is-${tone}" style="--i:${i}">
        <div class="td-top"><span class="td-time">${esc(x.startTime)}–${esc(x.endTime)}</span><span class="td-state"><span class="td-dot"></span>${state}</span></div>
        <p class="td-subject">${esc(x.subject || "Subject not listed")}${tag}</p>
        <p class="td-meta">${room}${who ? " · " + esc(who) : ""}${it.e && !c.section && x.section ? " · Section " + esc(x.section) : ""}</p>
        ${n && n.note ? `<p class="td-note">“${esc(n.note)}”</p>` : ""}
        ${n ? `<p class="td-meta">Posted by ${esc(n.teacherName || "your teacher")} <span class="u-badge">Verified</span></p>` : ""}</li>`;
    }).join("") || `<li class="td-empty"><strong>No classes on ${esc(day)}</strong><span>Pick another date from the bar above.</span></li>`;

    const posts = forMe.filter((n) => n.type === "notice").sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
    const postRows = posts.map((p) => `<li class="td-post"><div>
        <p class="td-post-t">${esc(KIND[p.kind] || "Notice")} <span class="u-badge">Verified · ${esc(p.teacherName || "Teacher")}</span></p>
        <p class="td-note">${esc(p.note)}</p></div></li>`).join("")
      || `<li class="td-empty"><strong>Nothing new</strong><span>Notices from your teachers for ${esc(prettyDate(date))} will show here.</span></li>`;

    const names = new Map();
    mine.forEach((e) => teachersOf(e).forEach((nm) => names.set(nm, 1)));
    const chips = [...names.keys()].sort().map((nm) => `<button type="button" class="cp-chip" data-teacher="${esc(nm)}">${esc(nm)}</button>`).join("");

    ROOT.innerHTML = `
      <header class="page-head td-head">
        <div><h1 class="page-title">My class.</h1><p class="page-sub">${esc(classLabel(c))} · ${esc(prettyDate(date))}</p></div>
        <div class="td-who"><button type="button" class="td-btn" data-act="change">Change class</button></div>
      </header>
      <div class="split split-even">
        <section class="panel"><div class="panel-head"><h2>Timetable · ${esc(day)}</h2></div><ul class="td-list">${cards}</ul></section>
        <section class="panel"><div class="panel-head"><h2>From your teachers</h2></div><ul class="td-list">${postRows}</ul>
          ${chips ? `<div class="panel-head cp-sub"><h2>Your teachers</h2></div><div class="cp-chips">${chips}</div>` : ""}</section>
      </div>`;
  } catch (err) {
    if (tk !== token) return;
    console.error(err);
    ROOT.innerHTML = `<header class="page-head"><h1 class="page-title">My class.</h1></header><section class="panel"><p>Could not load your class. Check your connection and try again.</p></section>`;
  }
}
ROOT.addEventListener("click", (ev) => {
  const chip = ev.target.closest("[data-teacher]");
  if (chip) {
    location.hash = "#teachers";
    const i = $("teacher-input"); i.value = chip.dataset.teacher; i.dispatchEvent(new Event("input"));
    return;
  }
  if (ev.target.closest("[data-act=change]")) openClassSheet();
});

window.addEventListener("noclass:myclass", () => { paintPill(); render(); });
window.addEventListener("hashchange", render);
new MutationObserver(render).observe($("when-text"), { childList: true, characterData: true, subtree: true });
paintPill(); render();
