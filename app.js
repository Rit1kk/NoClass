// app.js — NoClass
// Same Firestore collections and queries as before. New in this file:
// the screen switching, the day view grid, "free until" times, and
// in-memory caching so rooms, teachers and each day's timetable are read once.

import { db } from "./firebase-config.js";
import { getMyClass, matches, audienceMatches, classLabel, getBranchEntries } from "./classopts.js";
import {
  collection, getDocs, addDoc, query, where, orderBy, limit, writeBatch, doc, serverTimestamp, increment
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { BAD_WORDS, MILD_WORDS, BAD_DEVANAGARI } from "./good.js";
/* ============================================================
   Small helpers
   ============================================================ */
const $ = (id) => document.getElementById(id);
const pad = (n) => String(n).padStart(2, "0");
const FLAG_HIDE = 3;   // a post is hidden for everyone after this many flags

// Turn user-entered text into safe text before it goes into the page.
function esc(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

// "10:30" -> 630 (minutes since midnight)
function toMin(hhmm) {
  const [h, m] = String(hhmm).split(":").map(Number);
  return h * 60 + (m || 0);
}

const dayNameOf = (dateStr) =>
  new Date(dateStr + "T00:00:00").toLocaleDateString("en-US", { weekday: "long" });

const prettyDate = (dateStr) =>
  new Date(dateStr + "T00:00:00").toLocaleDateString("en-GB", {
    weekday: "long", day: "numeric", month: "short", year: "numeric"
  });

function timeAgo(iso) {
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return "";
  const mins = Math.floor((Date.now() - t) / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins} min ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours} h ago`;
  return `${Math.floor(hours / 24)} d ago`;
}

const REPORT_LABELS = {
  cancelled: "Class cancelled",
  absent: "Teacher absent",
  "room-changed": "Room changed"
};

// Small inline icons for the Updates and Lost & Found screens.
const ICON_PATHS = {
  cancelled: '<circle cx="12" cy="12" r="8.5"/><path d="M6 6l12 12"/>',
  absent: '<circle cx="12" cy="8.5" r="3.5"/><path d="M5 20c.9-3.7 3.7-5.5 7-5.5s6.1 1.8 7 5.5"/>',
  "room-changed": '<path d="M4 8h13M13.5 4.5 17 8l-3.5 3.5"/><path d="M20 16H7M10.5 12.5 7 16l3.5 3.5"/>',
  lost: '<circle cx="11" cy="11" r="6.5"/><path d="M16 16l4.5 4.5"/>',
  found: '<circle cx="12" cy="12" r="8.5"/><path d="M8 12.5l2.8 2.8 5.2-5.6"/>',
  extra: '<path d="M12 5v14M5 12h14"/>',
  notice: '<path d="M5 5h14v10H10l-5 4z"/>',
  pin: '<path d="M12 21s6.5-5.6 6.5-11a6.5 6.5 0 1 0-13 0c0 5.4 6.5 11 6.5 11z"/><circle cx="12" cy="10" r="2.3"/>'
};
const icon = (name) =>
  `<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">${ICON_PATHS[name] || ""}</svg>`;

// Friendly empty / error block. Only ever called with fixed text, never user input.
const emptyState = (tag, iconName, title, text, ok) =>
  `<${tag} class="nc-empty${ok ? " is-ok" : ""}">${iconName ? icon(iconName) : ""}<strong>${title}</strong><span>${text}</span></${tag}>`;

/* ============================================================
   Data loading (each thing is read from Firestore once)
   ============================================================ */
let roomsPromise = null;
let roomMap = new Map();

function getRooms() {
  if (!roomsPromise) {
    roomsPromise = getDocs(collection(db, "rooms"))
      .then((snap) => {
        const list = [];
        snap.forEach((d) => list.push({ id: d.id, ...d.data() }));
        list.sort((a, b) =>
          String(a.name).localeCompare(String(b.name), undefined, { numeric: true })
        );
        roomMap = new Map(list.map((r) => [r.roomId, r]));
        return list;
      })
      .catch((err) => { roomsPromise = null; throw err; });
  }
  return roomsPromise;
}

const dayCache = new Map();
function getDayEntries(day) {
  if (!dayCache.has(day)) {
    const q = query(collection(db, "timetable"), where("day", "==", day));
    dayCache.set(
      day,
      getDocs(q)
        .then((snap) => {
          const list = [];
          snap.forEach((d) => list.push({ _id: d.id, ...d.data() }));
          return list;
        })
        .catch((err) => { dayCache.delete(day); throw err; })
    );
  }
  return dayCache.get(day);
}

let teachersPromise = null;
function getTeachers() {
  if (!teachersPromise) {
    teachersPromise = getDocs(collection(db, "teachers"))
      .then((snap) => {
        const list = [];
        snap.forEach((d) => list.push(d.data()));
        return list;
      })
      .catch((err) => { teachersPromise = null; throw err; });
  }
  return teachersPromise;
}

// Teacher notices (cancelled class, room change, general notice): read once per date, cached for 30 s.
const noticeCache = new Map();
function getNotices(date) {
  const hit = noticeCache.get(date);
  if (hit && Date.now() - hit.t < 30000) return hit.p;
  const p = getDocs(query(collection(db, "notices"), where("date", "==", date)))
    .then((snap) => { const l = []; snap.forEach((d) => l.push({ id: d.id, ...d.data() })); return l; })
    .catch(() => []);                       // if notices cannot be read, the rest of the app still works
  noticeCache.set(date, { t: Date.now(), p });
  return p;
}

const roomName = (roomId) => (roomMap.get(roomId) || {}).name || roomId || "Room not listed";

/* ============================================================
   Screens (Rooms, Teachers, Updates, Lost & Found)
   ============================================================ */
const SCREENS = ["rooms", "teachers", "updates", "lostfound", "myclass", "dashboard"];
let currentScreen = null;

function route() {
  const hash = location.hash.slice(1);
  const name = SCREENS.includes(hash) ? hash : (currentScreen || "rooms");
  currentScreen = name;
  document.body.dataset.screen = name;
  SCREENS.forEach((s) => { $("screen-" + s).hidden = s !== name; });
  document.querySelectorAll(".nav-link").forEach((a) => {
    if (a.dataset.screen === name) a.setAttribute("aria-current", "page");
    else a.removeAttribute("aria-current");
  });
  window.scrollTo(0, 0);
}

/* ============================================================
   Shared date + time
   ============================================================ */
const dateInput = $("date-input");
const timeInput = $("time-input");
const state = { date: "", time: "" };

function setNow() {
  const d = new Date();
  dateInput.value = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  timeInput.value = `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function onWhenChange() {
  const date = dateInput.value;
  const time = timeInput.value;
  if (!date || !time) return;
  const dateChanged = date !== state.date;
  if (!dateChanged && time === state.time) return;

  state.date = date;
  state.time = time;
  $("when-text").textContent = `${prettyDate(date)} · ${time}`;
  if (dateChanged) $("report-date").value = date;
  $("date-label").textContent = shortDate(date);
$("time-label").textContent = time;
if (dateChanged) animateTiles = true;

  renderRooms();
  if (dateChanged) renderReports();
  if ($("teacher-input").value.trim() || (myClass && location.hash === "#teachers")) searchTeachers(false);
}
function shortDate(d) {
  const day = new Date(d + "T00:00:00"), today = new Date();
  today.setHours(0, 0, 0, 0);
  const diff = Math.round((day - today) / 864e5);
  if (diff === 0) return "Today";
  if (diff === 1) return "Tomorrow";
  if (diff === -1) return "Yesterday";
  return day.toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" });
}
function shiftWhen(mins) {
  const d = new Date(`${dateInput.value}T${timeInput.value || "00:00"}`);
  if (isNaN(d)) return;
  d.setMinutes(d.getMinutes() + mins);
  dateInput.value = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  timeInput.value = `${pad(d.getHours())}:${pad(d.getMinutes())}`;
  onWhenChange();
}
document.querySelectorAll("[data-when-step]").forEach((b) =>
  b.addEventListener("click", () => shiftWhen(Number(b.dataset.whenStep))));
[dateInput, timeInput].forEach((i) =>
  i.addEventListener("click", () => { try { i.showPicker(); } catch (_) {} }));

/* ============================================================
   ROOMS: free list + day view grid
   ============================================================ */
const GRID_START = 9 * 60;
const GRID_END = 18 * 60;
const GRID_HOURS = (GRID_END - GRID_START) / 60;
let roomsToken = 0;

let latestRoomRows = [];
let roomStatusFilter = "all";

const openRooms = new Set();
let animateTiles = true;
let latestT = 0;
let gridAll = false;
const fmt = (m) => `${pad(Math.floor(m / 60))}:${pad(m % 60)}`;
const CHEV = '<svg class="tile-chev" viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m6 9 6 6 6-6"/></svg>';

function freeAt(classes, t) {
  let at = null;
  for (const e of classes) {
    const s = toMin(e.startTime), en = toMin(e.endTime);
    if (at === null) { if (t >= s && t < en) at = en; }
    else if (s <= at && en > at) at = en;
  }
  return at;
}

function renderRoomTiles(rows) {
  const list = $("results-container");
  const queryText = $("room-search").value.trim().toLowerCase();
  const filtered = rows.filter(({ room, busy }) => {
    const roomText = `${room.name || ""} ${room.roomId || ""}`.toLowerCase();
    return (!queryText || roomText.includes(queryText)) &&
      (roomStatusFilter === "all" || (roomStatusFilter === "free" && !busy) || (roomStatusFilter === "busy" && busy));
  });

  $("results-title").textContent = `Showing ${filtered.length} of ${rows.length} rooms`;
  if (!rows.length) { list.innerHTML = `<p class="empty">No rooms found in the database.</p>`; return; }
  if (!filtered.length) {
    list.innerHTML = `<p class="empty room-empty">No rooms match. Try another name or choose “All”.</p>`;
    return;
  }

  const staff = (e) => Array.isArray(e.teachers) && e.teachers.length ? e.teachers.join(", ") : (e.teacher || "Faculty not listed");
  const info = (label, e) => `<div class="tile-block"><span class="tile-k">${label}</span>
      <p class="tile-subject">${esc(e.subject || "Subject not listed")}</p>
      <p class="tile-teacher">${esc(staff(e))}</p>
      <p class="tile-meta">${esc(e.branch || "Branch not listed")} · Sem ${esc(e.semester ?? "—")}${e.section ? ` · Section ${esc(e.section)}` : ""} · ${esc(e.startTime)}–${esc(e.endTime)}</p></div>`;

  let idx = 0;
  const tile = ({ room, classes, busy, currentClasses, next, lfPosts: notes }) => {
    const i = idx++;
    const title = room.name || room.roomId || "Room";
    const current = currentClasses[0] || null;
    const at = busy ? freeAt(classes, latestT) : null;
    const sub = busy ? (at !== null ? `Free at ${fmt(at)}` : "In class") : (next ? `Until ${esc(next.startTime)}` : "Rest of the day");
    const open = openRooms.has(room.roomId);
    const note = notes[0]
      ? `<button type="button" class="tile-note" data-lf-room="${esc(room.roomId)}" aria-label="View Lost and Found notes for ${esc(title)}">
          <span class="tile-note-top"><span class="tile-note-tag">${notes[0].type === "found" ? "Found" : "Lost & Found"}</span>${notes.length > 1 ? `<span class="tile-note-count">${notes.length} recent</span>` : ""}</span>
          <span class="tile-note-text">${esc(notes[0].description || "No description provided")}</span>
          <span class="tile-note-link">View room notes ↗</span></button>` : "";
    const chips = classes.length
      ? `<div class="tile-block"><span class="tile-k">Today</span><div class="tile-chips">${classes.map((e) =>
          `<span class="chip${currentClasses.includes(e) ? " is-now" : ""}">${esc(e.startTime)}–${esc(e.endTime)}</span>`).join("")}</div></div>` : "";
    return `<article class="room-tile ${busy ? "is-busy" : "is-free"}${open ? " is-open" : ""}" role="listitem" data-room="${esc(room.roomId)}" style="--i:${i}">
      <button type="button" class="tile-head" aria-expanded="${open}" aria-controls="tm-${i}">
        <span class="tile-top">
          <span class="room-title-wrap"><span class="room-title">${esc(title)}</span>${room.isLab ? '<span class="tag-lab">Lab</span>' : ""}</span>
          <span class="tile-right">${notes.length ? '<span class="tile-dot" title="Has Lost and Found notes"></span><span class="visually-hidden">Has Lost and Found notes</span>' : ""}${CHEV}</span>
        </span>
        <span class="tile-state"><span class="status-dot"></span>${busy ? "In class" : "Free"}</span>
        <span class="tile-sub">${sub}</span>
      </button>
      <div class="tile-more" id="tm-${i}"><div class="tile-more-inner"><div class="tile-body">
        ${current ? info("Now", current) : next ? info("Next class", next) : `<p class="tile-k">No more classes today.</p>`}
        ${chips}${note}
        <div class="tile-actions">${document.body.classList.contains("is-staff") ? `<button type="button" class="tile-report" data-extra-room="${esc(room.roomId)}">Use for extra class</button>` : ""}<button type="button" class="tile-report" data-report-room="${esc(room.roomId)}">Report issue</button></div>
      </div></div></div>
    </article>`;
  };

  const group = (label, arr) => arr.length ? `<p class="room-group" aria-hidden="true">${label}<span>${arr.length}</span></p>${arr.map(tile).join("")}` : "";
  list.classList.toggle("anim", animateTiles);
  animateTiles = false;
  list.innerHTML = group("Free", filtered.filter((r) => !r.busy)) + group("In class", filtered.filter((r) => r.busy));
}

$("results-container").addEventListener("click", (e) => {
  const head = e.target.closest(".tile-head");
  if (!head) return;
  const tile = head.parentElement, open = !tile.classList.contains("is-open");
  tile.classList.toggle("is-open", open);
  head.setAttribute("aria-expanded", String(open));
  open ? openRooms.add(tile.dataset.room) : openRooms.delete(tile.dataset.room);
});

function drawGrid() {
  const byName = (a, b) => String(a.room.name || a.room.roomId).localeCompare(String(b.room.name || b.room.roomId), undefined, { numeric: true });
  const all = latestRoomRows.slice().sort(byName);
  const shown = gridAll ? all : all.filter((r) => r.classes.length).slice(0, 8);
  const box = $("grid-container");
  box.innerHTML = shown.length ? buildGrid(shown, latestT) : `<p class="empty">No classes scheduled on this day.</p>`;
  $("grid-toggle").hidden = all.length <= 8;
  $("grid-toggle").textContent = gridAll ? "Show fewer rooms" : `Show all ${all.length} rooms`;
  const nowLine = box.querySelector(".g-now");
  if (nowLine && box.scrollWidth > box.clientWidth) box.scrollLeft = Math.max(0, nowLine.offsetLeft - box.clientWidth / 2);
}
$("grid-toggle").addEventListener("click", () => { gridAll = !gridAll; drawGrid(); });
$("info-btn").addEventListener("click", (e) => {
  const note = $("panel-note"), open = note.hidden;
  note.hidden = !open;
  e.currentTarget.setAttribute("aria-expanded", String(open));
});

function tween(el, to) {
  const from = parseInt(el.textContent, 10), id = (el._tw = (el._tw || 0) + 1);
  if (isNaN(from) || from === to || matchMedia("(prefers-reduced-motion: reduce)").matches) { el.textContent = to; return; }
  const t0 = performance.now();
  const step = (now) => {
    if (id !== el._tw) return;
    const p = Math.min(1, (now - t0) / 450);
    el.textContent = Math.round(from + (to - from) * (1 - Math.pow(1 - p, 3)));
    if (p < 1) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}

async function renderRooms() {
  const token = ++roomsToken;
  const { date, time } = state;
  const day = dayNameOf(date);
  const list = $("results-container");
  $("stat-when").textContent = `${day} · ${time}`;
  if (!list.children.length) list.innerHTML = `<p class="empty">Loading rooms…</p>`;

  try {
    const [rooms, rawEntries, notices] = await Promise.all([getRooms(), getDayEntries(day), getNotices(date)]);
    if (token !== roomsToken) return;
    // A teacher's cancellation (when "show room as free" is on) or room change moves the class out of its room.
    const gone = new Map(notices
      .filter((n) => n.entryId && (n.type === "room-changed" || (n.type === "cancelled" && n.freeRoom !== false)))
      .map((n) => [n.entryId, n]));
    const entries = rawEntries.flatMap((e) => {
      const n = gone.get(e._id);
      if (!n) return [e];
      return n.type === "room-changed" && n.newRoomId ? [{ ...e, roomId: n.newRoomId }] : [];
    }).concat(notices.filter((n) => n.type === "extra" && n.roomId && n.startTime && n.endTime)   // extra classes keep their room busy
      .map((n) => ({ _id: "x" + n.id, roomId: n.roomId, startTime: n.startTime, endTime: n.endTime, subject: n.subject || "Extra class", teachers: [n.teacherName], extra: true })));

    const t = toMin(time);
    const byRoom = new Map();
    entries.forEach((e) => {
      if (!e.roomId) return;
      if (!byRoom.has(e.roomId)) byRoom.set(e.roomId, []);
      byRoom.get(e.roomId).push(e);
    });

    const rows = rooms.map((room) => {
      const classes = (byRoom.get(room.roomId) || [])
        .slice()
        .sort((a, b) => toMin(a.startTime) - toMin(b.startTime));
      const currentClasses = classes.filter((e) => t >= toMin(e.startTime) && t < toMin(e.endTime));
      const busy = currentClasses.length > 0;
      const next = classes.find((e) => toMin(e.startTime) > t) || null;
      const notes = lfPosts.filter((post) => post.roomId === room.roomId);
      return { room, classes, currentClasses, busy, next, lfPosts: notes };
    });

    rows.sort((a, b) => {
      if (a.busy !== b.busy) return a.busy ? 1 : -1;
      return String(a.room.name || a.room.roomId).localeCompare(
        String(b.room.name || b.room.roomId), undefined, { numeric: true }
      );
    });
    latestRoomRows = rows;
    const freeCount = rows.filter((r) => !r.busy).length;
    latestT = t;
    tween($("stat-free"), freeCount);
    $("stat-total").textContent = rooms.length;
    renderRoomTiles(rows);

    drawGrid();
  } catch (err) {
    if (token !== roomsToken) return;
    console.error(err);
    $("stat-free").textContent = "–";
    $("stat-total").textContent = "–";
    list.innerHTML = `<p class="empty">Could not load rooms. Check your connection and try again.</p>`;
    $("grid-container").innerHTML = "";
  }
}

function buildGrid(rows, t) {
  const span = GRID_END - GRID_START;
  const hours = Array.from({ length: GRID_HOURS }, (_, i) => `<span>${pad(9 + i)}</span>`).join("");
  const cells = '<span class="g-cell"></span>'.repeat(GRID_HOURS);

  const body = rows.map(({ room, classes }) => {
    const bars = classes.map((e) => {
      const s = Math.max(toMin(e.startTime), GRID_START);
      const en = Math.min(toMin(e.endTime), GRID_END);
      if (en <= s) return "";
      const left = ((s - GRID_START) / span) * 100;
      const width = ((en - s) / span) * 100;
      const tip = `${e.startTime}–${e.endTime} · ${e.subject} · ${e.branch} Sem ${e.semester}${e.section ? " " + e.section : ""}`;
      return `<span class="g-bar${e.isLab ? " lab" : ""}" style="left:${left}%;width:${width}%" title="${esc(tip)}"></span>`;
    }).join("");
    return `<div class="g-row"><div class="g-label">${esc(room.name)}</div><div class="g-track">${cells}${bars}</div></div>`;
  }).join("");

  const nowLine = t >= GRID_START && t <= GRID_END
    ? `<div class="g-now" style="--p:${(t - GRID_START) / span}"></div>`
    : "";

  return `<div class="dgrid" role="img" aria-label="Scheduled classes for each room, 09:00 to 18:00">
    <div class="g-head"><div></div><div class="g-hours">${hours}</div></div>
    ${body}${nowLine}
  </div>`;
}

// "Report" link on a free room -> jump to the form with that room selected
$("results-container").addEventListener("click", (e) => {
  const lostFoundBtn = e.target.closest("[data-lf-room]");
  if (lostFoundBtn) {
    $("lf-filter-room").value = lostFoundBtn.dataset.lfRoom;
    renderLostFound();
    location.hash = "#lostfound";
    return;
  }
  const reportBtn = e.target.closest("[data-report-room]");
  if (!reportBtn) return;
  $("report-room").value = reportBtn.dataset.reportRoom;
  $("report-date").value = state.date;
  location.hash = "#updates";
  setTimeout(() => $("report-note").focus(), 0);
});

$("room-search").addEventListener("input", () => renderRoomTiles(latestRoomRows));
document.querySelectorAll("[data-room-filter]").forEach((btn) => {
  btn.addEventListener("click", () => {
    roomStatusFilter = btn.dataset.roomFilter;
    animateTiles = true;
    document.querySelectorAll("[data-room-filter]").forEach((other) =>
      other.setAttribute("aria-pressed", String(other === btn)));
    renderRoomTiles(latestRoomRows);
  });
});

/* ============================================================
   TEACHERS
   ============================================================ */


   const openTeachers = new Set();   // expanded cards survive re-renders
   const initials = (n) => String(n || "?").replace(/^(dr|mr|mrs|ms|prof)\.?\s+/i, "").split(/\s+/)
     .filter(Boolean).slice(0, 2).map((w) => w[0].toUpperCase()).join("") || "?";
   
   function teacherRow(teacher, entries, t, day, i, ctx = {}) {
  const hit = ctx.hit || new Map();   // entryId -> teacher notice (cancelled / room changed)
  const mine = entries
    .filter((e) =>
      e.teacherCode === teacher.teacherCode ||
      (Array.isArray(e.teacherCodes) && e.teacherCodes.includes(teacher.teacherCode)))
    .sort((a, b) => toMin(a.startTime) - toMin(b.startTime));
  const isOff = (e) => (hit.get(e._id) || {}).type === "cancelled";
  const live = mine.filter((e) => !isOff(e));
  const now = live.filter((e) => t >= toMin(e.startTime) && t < toMin(e.endTime));
  const next = live.find((e) => toMin(e.startTime) > t);
  const rn = (e) => { const n = hit.get(e._id); return roomName(n && n.type === "room-changed" && n.newRoomId ? n.newRoomId : e.roomId); };
  const others = (e) => (Array.isArray(e.teachers) ? e.teachers : []).filter((n) => n !== teacher.name);

  let busy = false, none = false, state, sub;
  if (now.length) { busy = true; state = "In class now"; sub = `${now.map(rn).join(", ")} · until ${now[0].endTime}`; }
  else if (!mine.length) { none = true; state = "No classes"; sub = `Nothing scheduled on ${day}`; }
  else if (!live.length) { none = true; state = "Classes cancelled"; sub = "Cancelled by the teacher today"; }
  else if (next) { state = "Not in class"; sub = `Next ${next.startTime} · ${rn(next)}`; }
  else { state = "Done for today"; sub = "No more classes today"; }

  const key = teacher.teacherCode || teacher.name;
  const open = openTeachers.has(key);
  const slots = mine.map((e) => `<div class="t-slot${now.includes(e) ? " is-now" : ""}${isOff(e) ? " is-off" : ""}">
      <span class="t-time">${esc(e.startTime)}–${esc(e.endTime)}</span>
      <span class="t-what"><b>${esc(rn(e))}</b>${e.isLab ? '<span class="tag-lab">Lab</span>' : ""}${e._extra ? '<span class="tag-lab">Extra</span>' : ""}
        <span>${esc(e.subject || "")}</span>
        <small>${isOff(e) ? '<span class="t-off">Cancelled</span> · ' : ""}${esc(e.branch)} Sem ${esc(e.semester)}${e.section ? " · " + esc(e.section) : ""}${others(e).length ? ` · With ${esc(others(e).join(", "))}` : ""}</small></span>
    </div>`).join("");

  return `<li class="room-tile t-card ${busy ? "is-busy" : "is-free"}${none ? " is-none" : ""}${open ? " is-open" : ""}" data-key="${esc(key)}" style="--i:${i}">
    <button type="button" class="tile-head" aria-expanded="${open}" aria-controls="tt-${i}">
      <span class="tile-top">
        <span class="t-who"><span class="t-avatar" aria-hidden="true">${esc(initials(teacher.name))}</span>
          <span class="t-id"><span class="t-name">${esc(teacher.name)}</span><span class="t-line">${teacher.teacherCode ? `<span class="t-code">${esc(teacher.teacherCode)}</span>` : ""}${ctx.you ? '<span class="t-tag you">You</span>' : ctx.tag ? `<span class="t-tag">${esc(ctx.tag)}</span>` : ""}</span></span></span>
        <span class="tile-right">${CHEV}</span>
      </span>
      <span class="tile-state"><span class="status-dot"></span>${state}</span>
      <span class="tile-sub">${esc(sub)}</span>
    </button>
    <div class="tile-more" id="tt-${i}"><div class="tile-more-inner"><div class="tile-body">
      ${mine.length ? `<div class="tile-block"><span class="tile-k">${esc(day)}</span><div class="t-sched">${slots}</div></div>`
                    : `<p class="tile-k">No classes scheduled on ${esc(day)}.</p>`}
    </div></div></div>
  </li>`;
}

let teacherToken = 0;
async function searchTeachers(fromTyping) {
  const raw = $("teacher-input").value.trim();
  const q = raw.toLowerCase();
  const out = $("teacher-results-container");
  const title = $("teacher-results-title");
  const token = ++teacherToken;

  // With a class chosen, an empty search shows "Teachers of your class" instead of a hint.
  if ((!q && !myClass) || (q && fromTyping && q.length < 2)) {
    title.textContent = "";
    out.innerHTML = `<li class="empty">Type a teacher’s name or code to see where they are.</li>`;
    return;
  }
  if (!state.date || !state.time) {
    out.innerHTML = `<li class="empty">Select a date and time above first.</li>`;
    return;
  }

  const day = dayNameOf(state.date);
  const t = toMin(state.time);
  try {
    const [teachers, dayEntries, notices, branchEntries] = await Promise.all([
      getTeachers(), getDayEntries(day), getNotices(state.date),
      myClass ? getBranchEntries(myClass.branch).catch(() => []) : [], getRooms()
    ]);
    if (token !== teacherToken) return;
    const codesOf = (list) => {
      const s = new Set();
      list.forEach((e) => { if (e.teacherCode) s.add(e.teacherCode); (e.teacherCodes || []).forEach((c) => s.add(c)); });
      return s;
    };
    const classCodes = myClass ? codesOf(branchEntries.filter((e) => matches(myClass, e))) : new Set();
    const deptCodes = myClass ? codesOf(branchEntries) : new Set();

    // Search by either display name or unique teacher code (e.g. CST-SD).
    let matched = q
      ? teachers.filter((x) => String(x.name || "").toLowerCase().includes(q) || String(x.teacherCode || "").toLowerCase().includes(q))
      : teachers.filter((x) => classCodes.has(x.teacherCode));
    if (!q && !matched.length) matched = teachers.filter((x) => deptCodes.has(x.teacherCode));
    if (!matched.length) {
      title.textContent = "";
      out.innerHTML = `<li class="empty">${q ? `No teacher found matching “${esc(raw)}”.` : "No teachers found for your class yet."}</li>`;
      return;
    }
    const rank = (x) => (classCodes.has(x.teacherCode) ? 0 : deptCodes.has(x.teacherCode) ? 1 : 2);
    matched = matched.slice().sort((a, b) => rank(a) - rank(b) || String(a.name).localeCompare(String(b.name)));

    // Teacher posts for this date: cancelled classes, room changes, extra classes.
    const hit = new Map();
    notices.filter((n) => n.entryId && (n.type === "cancelled" || n.type === "room-changed")).forEach((n) => hit.set(n.entryId, n));
    const extras = notices.filter((n) => n.type === "extra" && n.roomId && n.startTime && n.endTime).map((n) => ({
      _id: "x" + n.id, _extra: true, day, teacherCode: n.teacherCode, roomId: n.roomId, startTime: n.startTime, endTime: n.endTime,
      subject: n.subject || "Extra class", branch: n.audience && n.audience.branch, semester: n.audience && n.audience.semester, section: n.audience && n.audience.section
    }));
    const entries = dayEntries.concat(extras);

    title.textContent = q ? `${matched.length} result${matched.length === 1 ? "" : "s"}` : "Teachers of your class";
    out.classList.toggle("anim", !out.querySelector(".t-card"));   // stagger-in only for a fresh result set
    out.innerHTML = matched.map((tc, i) => teacherRow(tc, entries, t, day, i, {
      hit, you: document.body.dataset.staffCode === tc.teacherCode,
      tag: classCodes.has(tc.teacherCode) ? "Your teacher" : deptCodes.has(tc.teacherCode) ? "Your dept" : ""
    })).join("");
  } catch (err) {
    if (token !== teacherToken) return;
    console.error(err);
    title.textContent = "";
    out.innerHTML = `<li class="empty">Could not load teachers. Check your connection and try again.</li>`;
  }
}

$("teacher-results-container").addEventListener("click", (e) => {
  const head = e.target.closest(".tile-head");
  if (!head) return;
  const card = head.parentElement, open = !card.classList.contains("is-open");
  card.classList.toggle("is-open", open);
  head.setAttribute("aria-expanded", String(open));
  open ? openTeachers.add(card.dataset.key) : openTeachers.delete(card.dataset.key);
});

$("teacher-form").addEventListener("submit", (e) => { e.preventDefault(); searchTeachers(false); });
let teacherTimer;
$("teacher-input").addEventListener("input", () => {
  clearTimeout(teacherTimer);
  teacherTimer = setTimeout(() => searchTeachers(true), 200);
});

/* ============================================================
   UPDATES (reports)
   ============================================================ */
   let reportsToken = 0;
   const NOTICE_LABELS = { ...REPORT_LABELS, notice: "Notice", extra: "Extra class" };
   const KIND_LABELS = { quiz: "Quiz or test", assignment: "Assignment due" };
   let myClass = getMyClass();          // saved on this device from the home page or the class pill
   let showAllNotices = false;
   const audText = (a) => a ? [a.branch, a.semester ? "Sem " + a.semester : "", a.section ? "Section " + a.section : ""].filter(Boolean).join(" · ") || "All students" : "All students";
   const labelOf = (r) => r.type === "notice" ? (KIND_LABELS[r.kind] || "Notice") : (NOTICE_LABELS[r.type] || r.type);
   window.addEventListener("noclass:myclass", () => {
     myClass = getMyClass();
     renderReports();
     if (location.hash === "#teachers") searchTeachers(false);
   });
   // mode "new" = a report was just submitted: no re-animation, highlight the newest one
   async function renderReports(mode) {
     const date = state.date;
     const token = ++reportsToken;
     const out = $("reports-container");
     const summary = $("reports-summary");
     $("reports-title").textContent = `Reports for ${prettyDate(date)}`;
     try {
       const [snap, notices, dayEntries] = await Promise.all([
         getDocs(query(collection(db, "reports"), where("date", "==", date))),
         getNotices(date),
         getDayEntries(dayNameOf(date)).catch(() => []),
         getRooms()
       ]);
       if (token !== reportsToken) return;
       const reports = [];
       snap.forEach((d) => { const r = { ...d.data(), _id: d.id }; if ((r.flagCount || 0) < FLAG_HIDE) reports.push(r); });
       const myRooms = new Set(myClass ? dayEntries.filter((e) => matches(myClass, e)).map((e) => e.roomId) : []);
       const teacher = notices.filter((n) => showAllNotices || audienceMatches(myClass, n.audience)).map((n) => ({ ...n, teacher: true }));
       const rank = (r) => (r.teacher ? 2 : 0) + (myRooms.has(r.roomId) ? 1 : 0);   // your teachers, then your class's rooms, then the rest
       const items = [...teacher, ...reports].sort((a, b) => rank(b) - rank(a) || String(b.createdAt || "").localeCompare(String(a.createdAt || "")));

       let scope = $("u-scope");
       if (!scope) {
         scope = document.createElement("p"); scope.id = "u-scope"; scope.className = "u-scope";
         summary.before(scope);
         scope.addEventListener("click", (e) => { if (e.target.closest("[data-scope]")) { showAllNotices = !showAllNotices; renderReports(); } });
       }
       scope.hidden = !myClass;
       scope.innerHTML = myClass ? `Teacher notices for <b>${esc(classLabel(myClass))}</b> · <button type="button" data-scope>${showAllNotices ? "Only my class" : "Show all"}</button>` : "";

       const badge = $("nav-updates-count");
       badge.textContent = items.length;
       badge.hidden = items.length === 0;

       if (!items.length) {
         summary.innerHTML = "";
         out.classList.remove("anim");
         out.innerHTML = emptyState("li", "found", "All quiet", "No reports for this date yet.", true);
         return;
       }

       const counts = {};
       items.forEach((r) => { const k = labelOf(r); counts[k] = (counts[k] || 0) + 1; });
       summary.innerHTML = Object.entries(counts)
         .map(([label, n]) => `<span class="u-chip">${esc(label)}<b>${n}</b></span>`)
         .join("");

       out.classList.toggle("anim", mode !== "new");
       out.innerHTML = items.map((r, i) => {
         const where = r.type === "notice" ? "Notice"
           : r.type === "extra" ? `${roomName(r.roomId)} · ${r.startTime}–${r.endTime}`
           : r.type === "room-changed" && r.newRoomId ? `${roomName(r.roomId)} → ${roomName(r.newRoomId)}` : roomName(r.roomId);
         return `
         <li class="u-item${mode === "new" && i === 0 && !r.teacher ? " is-new" : ""}" data-type="${esc(r.type)}" style="--i:${i}">
           <span class="u-ico">${icon(r.type)}</span>
           <div class="u-main">
             <p class="u-line"><span class="u-room">${esc(where)}</span><span class="u-type">${esc(labelOf(r))}</span>${r.teacher ? `<span class="u-badge">Verified · ${esc(r.teacherName || "Teacher")}</span>` : myRooms.has(r.roomId) ? '<span class="u-badge mine">Your class</span>' : ""}</p>
             ${r.teacher ? `<p class="u-aud">${esc(audText(r.audience))}${r.subject ? " · " + esc(r.subject) : ""}</p>` : ""}
             ${r.note ? `<p class="u-note">${esc(r.note)}</p>` : ""}
                          ${!r.teacher && r._id ? `<button type="button" class="flag-btn" data-flag="reports" data-id="${esc(r._id)}">Report this</button>` : ""}
           </div>
           <time class="u-time" datetime="${esc(r.createdAt)}">${esc(timeAgo(r.createdAt))}</time>
         </li>`;
       }).join("");
     } catch (err) {
       if (token !== reportsToken) return;
       console.error(err);
       summary.innerHTML = "";
       out.innerHTML = emptyState("li", "", "Couldn’t load reports", "Check your connection and try again.");
     }
   }

function showStatus(el, message, isError) {
  el.hidden = false;
  el.textContent = message;
  el.classList.toggle("is-error", !!isError);
}

/* ---- text safety (client side) ---- */
// add your Hinglish / Hindi words here as lowercase letters, e.g. "wordone","wordtwo"
const USE_MILD = false;                                   // set to true to also block the mild words
const norm = (w) => w.replace(/(.)\1+/g, "$1");           // "chuutiyaa" -> "chutiya"
const BAD = new Set((USE_MILD ? BAD_WORDS.concat(MILD_WORDS) : BAD_WORDS).map(norm));
const BAD_DEV = new Set(BAD_DEVANAGARI);
const LEET = { "0": "o", "1": "i", "3": "e", "4": "a", "5": "s", "7": "t", "@": "a", "$": "s", "!": "i" };

function checkText(raw) {
  const text = String(raw || "").trim();
  if (text.length < 3) return "Please write a little more.";
  if (/(https?:\/\/|www\.|\b[a-z0-9-]+\.(com|in|net|org|me|xyz|co)\b)/i.test(text)) return "Links are not allowed.";
  if (/\S+@\S+\.\S+/.test(text)) return "Please don't share email addresses.";
  if (/\d{10}/.test(text.replace(/[\s\-().+]/g, ""))) return "Please don't share phone numbers.";
  if (/(.)\1{5,}/.test(text)) return "That looks like spam. Please write a normal note.";
  const words = text.toLowerCase().replace(/[01345 7@$!]/g, (ch) => LEET[ch] || " ").split(/[^a-z]+/);
  if (words.some((w) => BAD.has(norm(w)))) return "Please keep it respectful.";
  if (text.split(/[^\u0900-\u097F]+/).some((w) => BAD_DEV.has(w))) return "Please keep it respectful.";
  return null;
}

const COOLDOWN_MS = 60000;
function cooldownLeft() {
  try { return Math.max(0, COOLDOWN_MS - (Date.now() - (+localStorage.getItem("noclass-last-post") || 0))); }
  catch (e) { return 0; }
}
function markPosted() { try { localStorage.setItem("noclass-last-post", String(Date.now())); } catch (e) { /* private mode */ } }
/* ---- anonymous identity + safe posting ---- */
let authMod = null;
async function ensureUid() {
  authMod = authMod || await import("https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js");
  const auth = authMod.getAuth();
  if (auth.currentUser) return auth.currentUser.uid;
  return (await authMod.signInAnonymously(auth)).user.uid;
}
// the post and the rate marker are written together, so the rules can check them as one unit
async function postWithRate(col, data) {
  const uid = await ensureUid();
  const b = writeBatch(db);
  b.set(doc(db, "rate", uid), { last: serverTimestamp() });
  b.set(doc(collection(db, col)), data);
  await b.commit();
}
async function flagPost(col, id, btn) {
  btn.disabled = true;
  try {
    const uid = await ensureUid();
    const b = writeBatch(db);
    b.set(doc(db, col, id, "flags", uid), { at: serverTimestamp() });
    b.update(doc(db, col, id), { flagCount: increment(1) });
    await b.commit();
    btn.textContent = "Thanks, reported";
  } catch (e) {
    console.warn(e);
    btn.textContent = e && e.code === "permission-denied" ? "Already reported" : "Try again";
    if (!(e && e.code === "permission-denied")) btn.disabled = false;
  }
}
document.addEventListener("click", (e) => {
  const b = e.target.closest("[data-flag]");
  if (b && !b.disabled) flagPost(b.dataset.flag, b.dataset.id, b);
});

$("report-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const roomId = $("report-room").value;
  const date = $("report-date").value;
  const type = (document.querySelector('input[name="report-type"]:checked') || {}).value || "cancelled";
  const note = $("report-note").value.trim();
  const status = $("report-status");
  const btn = $("report-btn");

  if (!roomId || !date) {
    showStatus(status, "Please select a room and a date.", true);
    return;
  }
  const badNote = note ? checkText(note) : null;
  if (badNote) { showStatus(status, badNote, true); return; }
  const wait = cooldownLeft();
  if (wait) { showStatus(status, `Please wait ${Math.ceil(wait / 1000)} seconds before posting again.`, true); return; }
  btn.disabled = true;
  status.hidden = true;
  try {
    await postWithRate("reports", { roomId, date, type, note, createdAt: new Date().toISOString() });
    markPosted();
    showStatus(status, "Report submitted. Thank you.", false);
    $("report-note").value = "";
    if (date === state.date) renderReports("new");
  } catch (err) {
    console.error(err);
    showStatus(status, err && err.code === "permission-denied" ? "Please wait a minute before posting again." : "Could not submit the report. Please try again.", true);
  } finally {
    btn.disabled = false;
  }
});

/* ============================================================
   LOST & FOUND
   ============================================================ */
let lfPosts = [];
let lfType = "all";

async function loadLostFound() {
  const out = $("lostfound-results-container");
  try {
    const [snap] = await Promise.all([
      getDocs(query(collection(db, "lostFound"), orderBy("createdAt", "desc"), limit(20))),
      getRooms()
    ]);
    lfPosts = [];
    snap.forEach((d) => { const p = { ...d.data(), _id: d.id }; if ((p.flagCount || 0) < FLAG_HIDE) lfPosts.push(p); });
    renderLostFound(true);
    if (latestRoomRows.length) renderRooms();
  } catch (err) {
    console.error(err);
    out.innerHTML = emptyState("div", "", "Couldn’t load notes", "Check your connection and try again.");
  }
}

function renderLostFound(anim) {
  const out = $("lostfound-results-container");
  const roomFilter = $("lf-filter-room").value;
  const posts = lfPosts.filter((p) =>
    (lfType === "all" || p.type === lfType) && (!roomFilter || p.roomId === roomFilter));

  out.classList.toggle("anim", !!anim);
  if (!posts.length) {
    out.innerHTML = lfPosts.length
      ? emptyState("div", "lost", "No notes match", "Try another room, or choose All.")
      : emptyState("div", "found", "Nothing posted yet", "Lost or found something? Leave the first note.", true);
    return;
  }
  out.innerHTML = posts.map((p, i) => {
    const found = p.type === "found";
    return `
    <article class="lf-note" data-type="${found ? "found" : "lost"}" style="--i:${i}">
      <div class="lf-top">
        <span class="lf-badge">${icon(found ? "found" : "lost")}${found ? "Found" : "Lost"}</span>
        <time class="lf-time" datetime="${esc(p.createdAt)}">${esc(timeAgo(p.createdAt))}</time>
      </div>
      <p class="lf-body">${esc(p.description)}</p>
      <button type="button" class="lf-room" data-lf-pick="${esc(p.roomId)}" aria-label="Show only notes for ${esc(roomName(p.roomId))}">${icon("pin")}${esc(roomName(p.roomId))}</button>
            ${p._id ? `<button type="button" class="flag-btn" data-flag="lostFound" data-id="${esc(p._id)}">Report this</button>` : ""}
    </article>`;
  }).join("");
}

// Tap the room chip on a note to show only that room's notes
$("lostfound-results-container").addEventListener("click", (e) => {
  const pick = e.target.closest("[data-lf-pick]");
  if (!pick) return;
  $("lf-filter-room").value = pick.dataset.lfPick;
  renderLostFound(true);
});

document.querySelectorAll("[data-lf-type]").forEach((btn) => {
  btn.addEventListener("click", () => {
    lfType = btn.dataset.lfType;
    document.querySelectorAll("[data-lf-type]").forEach((b) =>
      b.setAttribute("aria-pressed", String(b === btn)));
    renderLostFound(true);
  });
});
$("lf-filter-room").addEventListener("change", () => renderLostFound(true));

$("lf-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const roomId = $("lf-room").value;
  const type = (document.querySelector('input[name="lf-type"]:checked') || {}).value || "lost";
  const description = $("lf-desc").value.trim();
  const status = $("lf-status");
  const btn = $("lf-btn");

  if (!roomId || !description) {
    showStatus(status, "Please select a room and write a description.", true);
    return;
  }
  const badDesc = checkText(description);
  if (badDesc) { showStatus(status, badDesc, true); return; }
  const wait = cooldownLeft();
  if (wait) { showStatus(status, `Please wait ${Math.ceil(wait / 1000)} seconds before posting again.`, true); return; }
  btn.disabled = true;
  status.hidden = true;
  try {
    await postWithRate("lostFound", { roomId, type, description, createdAt: new Date().toISOString() });
    markPosted();
    showStatus(status, "Posted. Thank you.", false);
    $("lf-desc").value = "";
    loadLostFound();
  } catch (err) {
    console.error(err);
    showStatus(status, err && err.code === "permission-denied" ? "Please wait a minute before posting again." : "Could not post the note. Please try again.", true);
  } finally {
    btn.disabled = false;
  }
});

/* ============================================================
   Room dropdowns (filled once from the cached room list)
   ============================================================ */
async function fillRoomSelects() {
  try {
    const rooms = await getRooms();
    const options = rooms.map((r) => `<option value="${esc(r.roomId)}">${esc(r.name)}</option>`).join("");
    $("report-room").innerHTML = options;
    $("lf-room").innerHTML = options;
    $("lf-filter-room").innerHTML = `<option value="">All rooms</option>${options}`;
  } catch (err) {
    console.error(err);
  }
}

/* ============================================================
   Theme (dark by default, persisted)
   ============================================================ */
const THEME_KEY = "noclass-theme";
const themeMeta = document.querySelector('meta[name="theme-color"]');

function currentTheme() {
  return document.documentElement.getAttribute("data-theme") === "light" ? "light" : "dark";
}

function applyTheme(theme) {
  document.documentElement.classList.add("theme-switching");
  const next = theme === "light" ? "light" : "dark";
  document.documentElement.setAttribute("data-theme", next);
  try { localStorage.setItem(THEME_KEY, next); } catch (_) {}
  if (themeMeta) themeMeta.setAttribute("content", next === "dark" ? "#111111" : "#DAF1DE");
  const toLight = next === "dark";
  const label = toLight ? "Light" : "Dark";
  const aria = toLight ? "Switch to light mode" : "Switch to dark mode";
  document.querySelectorAll("[data-theme-toggle]").forEach((btn) => {
    btn.setAttribute("aria-label", aria);
    const text = btn.querySelector("[data-theme-label]");
    if (text) text.textContent = label;
  });
  requestAnimationFrame(() => requestAnimationFrame(() =>             // add these two lines
    document.documentElement.classList.remove("theme-switching")));
}

document.querySelectorAll("[data-theme-toggle]").forEach((btn) => {
  btn.addEventListener("click", () => {
    applyTheme(currentTheme() === "dark" ? "light" : "dark");
  });
});
applyTheme(currentTheme());

/* ============================================================
   Start
   ============================================================ */
dateInput.addEventListener("input", onWhenChange);
dateInput.addEventListener("change", onWhenChange);
timeInput.addEventListener("input", onWhenChange);
timeInput.addEventListener("change", onWhenChange);
$("now-btn").addEventListener("click", () => { setNow(); onWhenChange(); });
// Calendar / clock icons: the real input sits under each icon and opens its own picker
function wirePicker(proxyId, main) {
  const proxy = document.getElementById(proxyId);
  const sync = () => { proxy.value = main.value; };      // open on the current date / time
  proxy.addEventListener("pointerdown", sync);
  proxy.addEventListener("focus", sync);

  const push = () => {                                    // copy the choice into the real input
    if (!proxy.value || proxy.value === main.value) return;
    main.value = proxy.value;
    main.dispatchEvent(new Event("input", { bubbles: true }));
    main.dispatchEvent(new Event("change", { bubbles: true }));
  };
  proxy.addEventListener("change", push);
  proxy.addEventListener("input", push);

  // keyboard: Enter / Space opens the picker
  proxy.addEventListener("keydown", (e) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      try { proxy.showPicker(); } catch (_) {}
    }
  });
  // Firefox only opens its picker from the icon, so open it on click there
  if (/firefox/i.test(navigator.userAgent)) {
    proxy.addEventListener("click", () => { try { proxy.showPicker(); } catch (_) {} });
  }
}
wirePicker("proxy-date", document.getElementById("date-input"));
wirePicker("proxy-time", document.getElementById("time-input"));
window.addEventListener("hashchange", route);
window.addEventListener("hashchange", () => { if (location.hash === "#teachers" && !$("teacher-input").value.trim() && myClass) searchTeachers(false); });
window.addEventListener("noclass:staff", () => {   // staff status is known: show / hide the staff-only buttons
  if (latestRoomRows.length) renderRoomTiles(latestRoomRows);
  if (location.hash === "#teachers") searchTeachers(false);
});

setNow();
route();
// Landing page links: ?teacher=Name (optionally &date=YYYY-MM-DD&time=HH:MM)
(function applyUrlParams() {
  const p = new URLSearchParams(location.search);
  const d = p.get("date"), t = p.get("time"), q = p.get("teacher");
  const dateEl = document.getElementById("date-input");
  const timeEl = document.getElementById("time-input");
  const teacherEl = document.getElementById("teacher-input");
  if (dateEl && /^\d{4}-\d{2}-\d{2}$/.test(d || "")) dateEl.value = d;
  if (timeEl && /^\d{2}:\d{2}$/.test(t || "")) timeEl.value = t;
  if (teacherEl && q) {
    teacherEl.value = q;
    setTimeout(() => teacherEl.dispatchEvent(new Event("input")), 300);
  }
})();
onWhenChange();
fillRoomSelects();
loadLostFound();