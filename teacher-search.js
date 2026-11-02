// teacher-search.js - teacher search on the landing page.
// Shows where a teacher is RIGHT NOW, directly under the search bar. No redirect to the dashboard.
import { db } from "./firebase-config.js";
import { collection, getDocs, query, where } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

const form = document.querySelector("#finder"), input = document.querySelector("#f-teacher"), hero = document.querySelector("#hero");

if (form && input && hero) {
  const esc = (v) => String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const toMin = (hhmm) => { const [h, m] = String(hhmm).split(":").map(Number); return h * 60 + (m || 0); };
  const pad = (n) => String(n).padStart(2, "0");
  const span = (m) => (m < 60 ? `${m} min` : `${Math.floor(m / 60)} h${m % 60 ? " " + (m % 60) + " min" : ""}`);

  // The result area sits right under the search bar.
  hero.querySelector(".hero-link")?.parentElement.classList.add("hero-link-p");
  form.insertAdjacentHTML("afterend", '<div class="tr-wrap" id="tr" aria-live="polite"><div class="tr-in"></div></div>');
  const wrap = document.querySelector("#tr"), box = wrap.querySelector(".tr-in");

  let cache = null, data = null, matches = [], sel = 0, token = 0, timer;

  // Reads teachers, today's timetable and rooms once (same collections as the dashboard).
  const load = () => (cache ||= (async () => {
    const day = new Date().toLocaleDateString("en-US", { weekday: "long" });
    const [t, tt, r] = await Promise.all([
      getDocs(collection(db, "teachers")),
      getDocs(query(collection(db, "timetable"), where("day", "==", day))),
      getDocs(collection(db, "rooms")),
    ]);
    return {
      day,
      teachers: t.docs.map((d) => d.data()),
      entries: tt.docs.map((d) => d.data()),
      rooms: new Map(r.docs.map((d) => [d.data().roomId, d.data().name])),
    };
  })().catch((e) => { cache = null; throw e; }));

  const roomOf = (e) => data.rooms.get(e.roomId) || e.roomId || "Room not listed";
  const put = (html) => { box.innerHTML = html; wrap.classList.add("open"); hero.classList.add("has-result"); };
  const clear = () => {
    matches = []; wrap.classList.remove("open"); hero.classList.remove("has-result");
    setTimeout(() => { if (!wrap.classList.contains("open")) box.innerHTML = ""; }, 650);
  };

  function card(tc, chips) {
    const d = new Date(), t = d.getHours() * 60 + d.getMinutes();
    const mine = data.entries
      .filter((e) => e.teacherCode === tc.teacherCode || (Array.isArray(e.teacherCodes) && e.teacherCodes.includes(tc.teacherCode)))
      .sort((a, b) => toMin(a.startTime) - toMin(b.startTime));
    const now = mine.find((e) => t >= toMin(e.startTime) && t < toMin(e.endTime));
    const next = mine.find((e) => toMin(e.startTime) > t);
    const ini = String(tc.name).replace(/^(dr|prof|mr|mrs|ms)\.?\s+/i, "").split(/\s+/).slice(0, 2).map((w) => w[0]).join("").toUpperCase();
    const info = (e) => `${e.branch} Sem ${e.semester}${e.section ? " · " + e.section : ""}${e.isLab ? " · Lab" : ""}`;
    let s, label, body;

    if (now) {
      const a = toMin(now.startTime), b = toMin(now.endTime);
      const others = (Array.isArray(now.teachers) ? now.teachers : []).filter((n) => n !== tc.name);
      s = "live"; label = "In class now";
      body = `<p class="tr-room">${esc(roomOf(now))}</p>
        <p class="tr-sub">${esc(now.subject)}</p>
        <p class="tr-extra">${esc(info(now))}${others.length ? " · With " + esc(others.join(", ")) : ""}</p>
        <div class="tr-bar"><i data-w="${Math.round(((t - a) / (b - a)) * 100)}"></i></div>
        <p class="tr-meta"><span>${esc(now.startTime)}</span><span>${span(b - t)} left</span><span>${esc(now.endTime)}</span></p>`;
    } else if (next) {
      s = "free"; label = "Free right now";
      body = `<p class="tr-line">Next class at <b>${esc(next.startTime)}</b> in <b>${esc(roomOf(next))}</b></p>
        <p class="tr-sub">${esc(next.subject)}</p>
        <p class="tr-extra">${esc(info(next))} · starts in ${span(toMin(next.startTime) - t)}</p>`;
    } else if (mine.length) {
      s = "off"; label = "Done for today";
      body = `<p class="tr-line">No more classes today.</p><p class="tr-extra">Last class ended at ${esc(mine[mine.length - 1].endTime)}</p>`;
    } else {
      s = "off"; label = "No classes today";
      body = `<p class="tr-line">Nothing scheduled on ${esc(data.day)}.</p>`;
    }

    return `<div class="tr" data-s="${s}">
      <div class="tr-top">
        <span class="tr-av">${esc(ini)}</span>
        <div><p class="tr-name">${esc(tc.name)}</p><p class="tr-day">${esc(data.day)} · ${pad(d.getHours())}:${pad(d.getMinutes())}</p></div>
        <span class="tr-state ${s}">${label}</span>
        <button type="button" class="tr-x" aria-label="Close result">&times;</button>
      </div>
      <div class="tr-body">${body}</div>${chips}</div>`;
  }

  function show() {
    const chips = matches.length > 1
      ? `<div class="tr-chips"><span>Also:</span>${matches.slice(0, 6).map((m, i) => (i === sel ? "" : `<button type="button" class="tr-chip" data-i="${i}">${esc(m.name)}</button>`)).join("")}</div>`
      : "";
    put(card(matches[sel], chips));
    box.querySelectorAll(".tr-bar i").forEach((el) =>
      requestAnimationFrame(() => requestAnimationFrame(() => { el.style.width = el.dataset.w + "%"; })));
  }

  async function run(raw, typing) {
    const q = raw.trim().toLowerCase(), my = ++token;
    if (q.length < (typing ? 2 : 1)) { if (!q) clear(); return; }
    if (!cache) put('<div class="tr tr-msg">Looking up the timetable…</div>');
    try {
      data = await load();
      if (my !== token) return;
      matches = data.teachers
        .filter((x) => String(x.name).toLowerCase().includes(q))
        .sort((a, b) => String(a.name).toLowerCase().indexOf(q) - String(b.name).toLowerCase().indexOf(q));
      sel = 0;
      if (matches.length) show();
      else put(`<div class="tr tr-msg">No teacher found for “${esc(raw.trim())}”.<br>Try only the surname.</div>`);
    } catch (err) {
      console.error(err);
      put('<div class="tr tr-msg">Could not load the timetable. Check your connection and try again.</div>');
    }
  }

  form.addEventListener("submit", (e) => { e.preventDefault(); run(input.value, false); });
  input.addEventListener("input", () => { clearTimeout(timer); timer = setTimeout(() => run(input.value, true), 250); });
  input.addEventListener("focus", () => load().catch(() => {}), { once: true });   // warm up while they type
  input.addEventListener("keydown", (e) => { if (e.key === "Escape") { input.value = ""; clear(); } });
  box.addEventListener("click", (e) => {
    const chip = e.target.closest(".tr-chip");
    if (chip) { sel = +chip.dataset.i; show(); return; }
    if (e.target.closest(".tr-x")) { input.value = ""; clear(); input.focus(); }
  });
  setInterval(() => { if (!document.hidden && matches.length) show(); }, 30000);   // keep "now" fresh
}
