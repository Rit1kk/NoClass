// landing.js - all motion on the Home page (dial, pill, reveals, dashboard preview).
// home.js (finder, live counts, staff sign-in) is unchanged. Remove this file's <script> tag to turn motion off.
window.__motionReady = true;
const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];

/* 1. Dial: dotted half circle, orbiting dot with trail, ticks that light up as it passes */
(function dial() {
  const svg = $("#dial"); if (!svg) return;
  const NS = "http://www.w3.org/2000/svg", CX = 850, CY = 860, R = 830, ORBIT = 12;   // ORBIT = seconds per lap
  const P = (t, r) => [CX - r * Math.cos(Math.PI * t), CY - r * Math.sin(Math.PI * t)];
  const mk = (n, a, p) => { const e = document.createElementNS(NS, n); for (const k in a) e.setAttribute(k, a[k]); p.appendChild(e); return e; };
  const dot = $("#dot");
  const T = Array.from({ length: 13 }, (_, i) => {
    const t = .08 + i * .07, [a, b] = P(t, 752), [c, d] = P(t, 770 + 12 * Math.sin(Math.PI * t));
    const l = mk("line", { x1: a, y1: b, x2: c, y2: d }, $("#ticks")); l.style.opacity = .18; return { l, t };
  });
  const TR = Array.from({ length: 16 }, (_, i) => mk("circle", { r: 2 - i * .05, fill: "var(--green)" }, $("#trail")));
  function draw(t) {
    const [x, y] = P(t, R); dot.setAttribute("cx", x); dot.setAttribute("cy", y);
    TR.forEach((c, i) => {
      const tt = t - (i + 1) * .0042; if (tt < 0) { c.style.opacity = 0; return; }
      const [a, b] = P(tt, R); c.setAttribute("cx", a); c.setAttribute("cy", b); c.style.opacity = 1 - i / 16;
    });
    T.forEach((k) => {
      const d = t - k.t, v = d >= -.004 ? Math.max(0, 1 - d / .15) : 0;
      k.l.style.opacity = .18 + .82 * v; k.l.style.strokeWidth = 1.1 + 1.6 * v; k.l.style.stroke = v > .4 ? "var(--green)" : "var(--ink)";
    });
  }
  draw(.7); if (reduce) return;
  let raf = 0, run = false, t0 = 0, off = 0, vis = true;
  const fr = (ts) => { draw((((ts - t0) / 1000 / ORBIT) + off) % 1); raf = requestAnimationFrame(fr); };
  const play = () => { if (run) return; run = true; t0 = performance.now(); raf = requestAnimationFrame(fr); };
  const pause = () => { if (!run) return; run = false; cancelAnimationFrame(raf); off = (off + (performance.now() - t0) / 1000 / ORBIT) % 1; };
  const sync = () => (vis && !document.hidden ? play() : pause());
  new IntersectionObserver(([e]) => { vis = e.isIntersecting; sync(); }).observe($("#hero"));
  document.addEventListener("visibilitychange", sync); sync();
})();

/* 2. Pill: a whole new box rises in while the old one leaves */
(function pill() {
  const box = $("#pillwrap"); if (!box) return;
  const ITEMS = [["\u25A6", "Free rooms, from the timetable"], ["\u263A", "Find any teacher"], ["\u2726", "Updates from students"], ["\u2315", "Lost and found"]];
  let i = -1;
  const next = () => {
    const old = $(".pillx:not(.leave)", box);
    if (old) { old.classList.add("leave"); setTimeout(() => old.remove(), 500); }
    i = (i + 1) % ITEMS.length;
    const d = document.createElement("div"); d.className = "pillx";
    const s = document.createElement("span"), b = document.createElement("b");
    s.textContent = ITEMS[i][0]; b.textContent = ITEMS[i][1]; b.style.fontWeight = "inherit";
    d.append(s, b); box.appendChild(d);
  };
  next(); if (!reduce) setInterval(() => { if (!document.hidden) next(); }, 2900);
})();

/* 3. Nav border and scroll reveals */
(function page() {
  const nav = $("#nav"), on = () => nav.classList.toggle("is-scrolled", scrollY > 8);
  addEventListener("scroll", on, { passive: true }); on();
  const els = $$(".reveal");
  if (!("IntersectionObserver" in window) || reduce) { els.forEach((e) => e.classList.add("is-in")); return; }
  const io = new IntersectionObserver((es) => es.forEach((e) => { if (e.isIntersecting) { e.target.classList.add("is-in"); io.unobserve(e.target); } }), { threshold: .12, rootMargin: "0px 0px -6% 0px" });
  els.forEach((e) => io.observe(e));
})();

/* 4. Self-playing preview of the dashboard (sample data) */
(function demo() {
  const root = $("#demo");
  if (!root) return;
    // ---- demo video: play only while on screen, pause button, respect reduced motion ----
    const video = $("#demo-video"), btn = $("#demo-toggle");
    let onScreen = false, userPaused = matchMedia("(prefers-reduced-motion: reduce)").matches;
    const paint = () => {
      if (!btn) return;
      btn.dataset.paused = String(userPaused);
      btn.setAttribute("aria-label", userPaused ? "Play demo video" : "Pause demo video");
    };
    const sync = () => {
      if (!video) return;
      if (onScreen && !document.hidden && !userPaused) { const p = video.play(); if (p && p.catch) p.catch(() => {}); }
      else video.pause();
    };
    if (video && "IntersectionObserver" in window) {
      new IntersectionObserver(([e]) => { onScreen = e.isIntersecting; sync(); }, { threshold: 0.2 }).observe(video);
    } else { onScreen = true; }
    document.addEventListener("visibilitychange", sync);
    if (btn) btn.addEventListener("click", () => { userPaused = !userPaused; paint(); sync(); });
    paint(); sync();
    return;   // the old sample-dashboard code below is no longer used
  const START = 9, SPAN = 9;
  const ROOMS = [
    ["M101", [[10, 12], [14, 15]]], ["M102", [[9, 11], [13, 15]]], ["M103", [[11, 13], [15, 17]]],
    ["M201", [[9, 10.5], [11, 12], [14, 16]]], ["M202", [[10, 12], [13, 15.5]]], ["M203", [[16, 18]]],
    ["J109", [[9, 10], [12, 14]]], ["J110", [[11, 12], [14, 15]]],
  ];
  const fmt = (h) => { const m = Math.round(h * 60); return String(Math.floor(m / 60)).padStart(2, "0") + ":" + String(m % 60).padStart(2, "0"); };

  const list = $("#d-list"), grid = $("#d-grid");
  grid.innerHTML = ROOMS.map(([n, iv]) =>
    `<div class="d-row"><span>${n}</span><div class="d-track">${iv.map(([s, e]) =>
      `<i class="d-bar" style="left:${((s - START) / SPAN) * 100}%;width:${((e - s) / SPAN) * 100}%"></i>`).join("")}</div></div>`
  ).join("") + `<div class="d-now-wrap"><i class="d-now" id="d-now"></i></div>`;
  const nowLine = $("#d-now");

  function show(t) {
    const free = ROOMS.map(([n, iv]) => ({
      n, busy: iv.some(([s, e]) => t >= s && t < e),
      next: iv.map((x) => x[0]).filter((s) => s > t).sort((a, b) => a - b)[0],
    })).filter((r) => !r.busy);
    list.innerHTML = free.length
      ? free.map((r) => `<li><span class="d-room">${r.n}</span><span class="d-until">${r.next ? "Free until " + fmt(r.next) : "Free all day"}</span></li>`).join("")
      : `<li class="d-empty">No free rooms</li>`;
    $("#d-free").textContent = free.length;
    $("#d-total").textContent = ROOMS.length;
    $("#d-time").textContent = fmt(t);
    nowLine.style.left = ((t - START) / SPAN) * 100 + "%";
  }

  const scenes = $$(".d-scene", root), navItems = $$(".d-nav li", root);
  const scene = (i) => {
    scenes.forEach((s, k) => s.classList.toggle("is-on", k === i));
    navItems.forEach((n, k) => n.classList.toggle("is-on", k === i));
  };
  show(10.5);
  if (reduce) return;

  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  let visible = true;
  if ("IntersectionObserver" in window) new IntersectionObserver(([e]) => { visible = e.isIntersecting; }).observe(root);
  const step = async (ms) => { await wait(ms); while (!visible || document.hidden) await wait(300); };

  const typed = $("#d-type"), result = $("#d-result"), n1 = $("#d-n1"), n2 = $("#d-n2");
  (async function loop() {
    for (;;) {
      scene(0); show(10.5); await step(2600);
      show(11.5); await step(2400);
      show(14.25); await step(2600);
      scene(1); typed.textContent = ""; result.classList.remove("is-on"); await step(900);
      for (const ch of "shipra") { typed.textContent += ch; await step(260); }
      await step(500); result.classList.add("is-on"); await step(3000);
      scene(2); n1.classList.remove("is-on"); n2.classList.remove("is-on"); await step(800);
      n1.classList.add("is-on"); await step(1500);
      n2.classList.add("is-on"); await step(3200);
    }
  })();
})();

/* 5. Teacher sign-in background: Luma Drift (WebGL). A plain JS port of the React component.
      Only touches #teachers. If WebGL is missing, the CSS fallback colour stays visible. */
      (function drift() {
        const host = $("#teachers"), canvas = $("#drift-canvas");
        if (!host || !canvas || canvas.dataset.ready) return;
        canvas.dataset.ready = "1";
      
        const SPEED = 0.6;          // 1 = original speed, lower is calmer
        const MAX_SIDE = 960;       // longest side of the drawing buffer in pixels, CSS scales it up
        const FPS = 30;
        const STILL_TIME = 24000;   // the frame shown when the visitor prefers reduced motion
      
        const VERT = `
      attribute vec2 position;
      varying vec2 vUv;
      void main() {
        gl_Position = vec4(position, 0.0, 1.0);
        vUv = (position.xy + 1.0) * 0.5;
      }`;
      
        const FRAG = `
      #ifdef GL_FRAGMENT_PRECISION_HIGH
      precision highp float;
      #else
      precision mediump float;
      #endif
      uniform float u_time;
      varying vec2 vUv;
      
      vec2 hash(vec2 p) {
        p = vec2(dot(p, vec2(127.1, 311.7)), dot(p, vec2(269.5, 183.3)));
        return -1.0 + 2.0 * fract(sin(p) * 43758.5453123);
      }
      
      float noise(vec2 p) {
        vec2 i = floor(p);
        vec2 f = fract(p);
        vec2 u = f * f * (3.0 - 2.0 * f);
        return mix(mix(dot(hash(i + vec2(0.0, 0.0)), f - vec2(0.0, 0.0)),
                       dot(hash(i + vec2(1.0, 0.0)), f - vec2(1.0, 0.0)), u.x),
                   mix(dot(hash(i + vec2(0.0, 1.0)), f - vec2(0.0, 1.0)),
                       dot(hash(i + vec2(1.0, 1.0)), f - vec2(1.0, 1.0)), u.x), u.y);
      }
      
      void main() {
        vec2 uv = vUv;
        float t = u_time * 0.0004;
      
        float warp = noise(vec2(uv.x * 1.2 + t, t * 0.2));
        vec2 uvWarped = uv;
        uvWarped.x += warp * 0.1;
      
        float n1 = noise(vec2(uvWarped.x * 2.0 + t * 0.5, uvWarped.y * 0.2 - t * 0.1));
        float n2 = noise(vec2(uvWarped.x * 4.0 - t * 0.8, uvWarped.y * 0.5 + t * 0.2));
      
        float aurora = abs(n1 + n2);
        aurora = pow(1.0 - smoothstep(0.0, 0.4, aurora), 4.0);
      
        float mask = smoothstep(0.0, 0.4, uv.y) * smoothstep(1.0, 0.5, uv.y);
        aurora *= mask;
      
        vec3 darkBlue = vec3(0.02, 0.04, 0.08);
        vec3 oceanBlue = vec3(0.05, 0.15, 0.35);
        vec3 skyBlue = vec3(0.1, 0.3, 0.6);
        vec3 cyan = vec3(0.2, 0.6, 0.9);
        vec3 brightGlow = vec3(0.4, 0.8, 1.0);
      
        vec3 col = darkBlue;
        col = mix(col, oceanBlue, aurora * 0.8);
        col = mix(col, skyBlue, pow(aurora, 2.0));
        col = mix(col, cyan, pow(aurora, 3.0));
        col += brightGlow * pow(aurora, 5.0) * 0.5;
      
        float grain = fract(sin(dot(uv, vec2(12.9898, 78.233))) * 43758.5453);
        col += grain * 0.02;
      
        gl_FragColor = vec4(col, 1.0);
      }`;
      
        const gl = canvas.getContext("webgl", { alpha: false, antialias: false, powerPreference: "low-power" })
          || canvas.getContext("experimental-webgl");
        if (!gl) return;
      
        const compile = (type, src) => {
          const s = gl.createShader(type);
          gl.shaderSource(s, src);
          gl.compileShader(s);
          if (gl.getShaderParameter(s, gl.COMPILE_STATUS)) return s;
          console.warn("Drift shader:", gl.getShaderInfoLog(s));
          gl.deleteShader(s);
          return null;
        };
        const vs = compile(gl.VERTEX_SHADER, VERT), fs = compile(gl.FRAGMENT_SHADER, FRAG);
        if (!vs || !fs) return;
        const prog = gl.createProgram();
        gl.attachShader(prog, vs); gl.attachShader(prog, fs); gl.linkProgram(prog);
        if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) { console.warn("Drift link:", gl.getProgramInfoLog(prog)); return; }
        gl.useProgram(prog);
      
        gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
        gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
        const pos = gl.getAttribLocation(prog, "position");
        gl.enableVertexAttribArray(pos);
        gl.vertexAttribPointer(pos, 2, gl.FLOAT, false, 0, 0);
        const uTime = gl.getUniformLocation(prog, "u_time");
      
        let t = reduce ? STILL_TIME : 0, last = 0, raf = 0, running = false, inView = true, dead = false;
        const FRAME = 1000 / FPS - 2;
      
        function draw() {
          if (dead) return;
          gl.uniform1f(uTime, t);
          gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
          canvas.classList.add("is-live");   // fades the canvas in over the CSS fallback
        }
      
        // Match the section's size, but never draw more than MAX_SIDE pixels on the long side.
        function resize() {
          const r = host.getBoundingClientRect();
          const k = Math.min(1, MAX_SIDE / Math.max(r.width, r.height, 1));
          const w = Math.max(1, Math.round(r.width * k)), h = Math.max(1, Math.round(r.height * k));
          if (canvas.width !== w || canvas.height !== h) {
            canvas.width = w; canvas.height = h;
            gl.viewport(0, 0, w, h);
          }
          draw();   // resizing clears the canvas, so redraw straight away
        }
      
        function tick(now) {
          raf = requestAnimationFrame(tick);
          const dt = now - last;
          if (dt < FRAME) return;
          last = now;
          t += Math.min(dt, 100) * SPEED;   // time only advances while drawing, so there is no jump after a pause
          draw();
        }
        const play = () => { if (running) return; running = true; last = performance.now(); raf = requestAnimationFrame(tick); };
        const pause = () => { running = false; cancelAnimationFrame(raf); };
        const sync = () => (inView && !document.hidden && !dead ? play() : pause());
      
        if ("ResizeObserver" in window) new ResizeObserver(resize).observe(host);
        else addEventListener("resize", resize);
        resize();
        if (reduce) return;   // one still frame, no animation loop
      
        if ("IntersectionObserver" in window) {
          new IntersectionObserver(([e]) => { inView = e.isIntersecting; sync(); }, { rootMargin: "120px 0px" }).observe(host);
        }
        document.addEventListener("visibilitychange", sync);
        canvas.addEventListener("webglcontextlost", (e) => { e.preventDefault(); dead = true; pause(); canvas.classList.remove("is-live"); });
        sync();
      })();