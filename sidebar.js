// sidebar.js (v2) - floating sidebar: hide/show, sub-item jumps, clean low "tok" sound.
(function () {
  const root = document.documentElement;
  const sb = document.getElementById("sidebar"), btn = document.getElementById("sb-toggle"), snd = document.getElementById("sb-sound");
  if (!sb || !btn) return;
  const store = {
    get: (k) => { try { return localStorage.getItem(k); } catch (e) { return null; } },
    set: (k, v) => { try { localStorage.setItem(k, v); } catch (e) { /* private mode */ } },
  };

  /* ---------- sound: a short, sharp, high click made in code (no audio file) ---------- */
  let ac = null, out = null, noise = null, on = store.get("noclass-sound") !== "off", lastHover = 0;
  const CLICK_URL = "click.wav";      // your file name. The path is relative to the HTML page
  let clickBuf = null;
  
  function wake() {
    if (!ac) {
      const C = window.AudioContext || window.webkitAudioContext;
      if (!C) return;
      ac = new C({ latencyHint: "interactive" });
      out = ac.createGain(); out.connect(ac.destination);
      fetch(CLICK_URL)                               // load and decode the file once
        .then((r) => r.arrayBuffer())
        .then((b) => ac.decodeAudioData(b))
        .then((buf) => { clickBuf = buf; })
        .catch((e) => console.warn("Sound file not loaded", e));
    }
    if (ac.state === "suspended") ac.resume();
  }
  addEventListener("pointerdown", wake, { once: true });   // browsers only allow sound after a click or key press
  addEventListener("keydown", wake, { once: true });

  function tick(freq, vol) {
    if (!on || !ac || ac.state !== "running" || !clickBuf) return;
    const s = ac.createBufferSource(), g = ac.createGain();
    s.buffer = clickBuf;
    s.playbackRate.value = freq / 3000;              // 3000 = your file at its original pitch
    g.gain.value = Math.min(1.5, vol / 0.15);        // loudness
    s.connect(g); g.connect(out); s.start();
  }

  const paintSound = () => {
    if (!snd) return;
    snd.setAttribute("aria-pressed", String(on));
    snd.setAttribute("aria-label", on ? "Sound on. Click to mute" : "Sound off. Click to unmute");
    snd.title = on ? "Sound on" : "Sound off";
  };
  paintSound();
  if (snd) snd.addEventListener("click", () => { on = !on; store.set("noclass-sound", on ? "on" : "off"); paintSound(); tick(3000, 0.16); });

  sb.addEventListener("pointerover", (e) => {               // soft tick when the pointer enters a menu line
    const row = e.target.closest(".nav-link, .nav-sub");
    if (!row || row.contains(e.relatedTarget)) return;
    const now = performance.now();
    if (now - lastHover < 60) return;
    lastHover = now;
    tick(row.classList.contains("nav-link") ? 3600 : 4200, 0.07);
  });
  sb.addEventListener("pointerdown", (e) => {               // click sound on press (no waiting for release)
    if (e.target.closest(".nav-link, .nav-sub, .sb-ico, .sb-dock a")) tick(2800, 0.18);
  });
  sb.addEventListener("click", (e) => {                     // keyboard (Enter) presses
    if (e.detail === 0 && e.target.closest(".nav-link, .nav-sub, .sb-ico, .sb-dock a")) tick(2800, 0.18);
  });

  /* ---------- theme icon: flips dark / light using the existing theme buttons ---------- */
  const themeBtn = document.getElementById("sb-theme");
  if (themeBtn) themeBtn.addEventListener("click", () => {
    const next = root.getAttribute("data-theme") === "light" ? "dark" : "light";
    const proxy = document.querySelector('[data-theme-set="' + next + '"]');
    if (proxy) proxy.click();
    else { root.setAttribute("data-theme", next); store.set("noclass-theme", next); }
  });

  /* ---------- hide / show ---------- */
  function setCollapsed(c, withSound) {
    root.classList.toggle("sb-collapsed", c);
    btn.setAttribute("aria-expanded", String(!c));
    btn.setAttribute("aria-label", c ? "Show sidebar" : "Hide sidebar");
    store.set("noclass-sidebar", c ? "closed" : "open");
    if (withSound) tick(c ? 2200 : 3400, 0.18);
  }
  setCollapsed(store.get("noclass-sidebar") === "closed", false);
  requestAnimationFrame(() => requestAnimationFrame(() => root.classList.add("sb-ready")));   // animate only after the first paint
  btn.addEventListener("click", () => setCollapsed(!root.classList.contains("sb-collapsed"), true));
  addEventListener("keydown", (e) => {                       // Ctrl + B also toggles it
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "b") { e.preventDefault(); btn.click(); }
  });

  /* ---------- sub items: open the page, then glide to that section ---------- */
  const subs = [...sb.querySelectorAll(".nav-sub")];
  let keep = null;
  const clearSubs = () => subs.forEach((s) => s.classList.remove("is-on"));
  subs.forEach((s) => s.addEventListener("click", (e) => {
    e.preventDefault();
    clearSubs(); s.classList.add("is-on");
    const go = () => {
      const target = document.getElementById(s.dataset.target);
      if (target) target.scrollIntoView({ behavior: "smooth", block: "center" });
    };
    if (location.hash.slice(1) !== s.dataset.screen) { keep = s; location.hash = "#" + s.dataset.screen; setTimeout(go, 150); }
    else go();
  }));
  addEventListener("hashchange", () => {                     // changing page clears the mark, except for the sub just clicked
    clearSubs();
    if (keep) { keep.classList.add("is-on"); keep = null; }
  });
})();