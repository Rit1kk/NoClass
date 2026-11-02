// theme-smooth.js - makes the dark/light switch change everything in one go.
// Drop-in: load it with  <script src="theme-smooth.js" defer></script>  (nothing in app.js changes).
// It listens for the theme button, pauses per-element colour transitions for a moment,
// and cross-fades the whole page where the browser supports View Transitions.
// Where it does not (or for visitors who asked for reduced motion), the theme simply flips at once.
(() => {
  const FADE = true;   // true: cross-fade the page (~0.26s).  false: flip instantly, no fade.
  const root = document.documentElement;
  const calm = matchMedia("(prefers-reduced-motion: reduce)");
  let replaying = false;

  const freeze = () => {                                  // flip every colour in the same frame
    root.classList.add("theme-switching");
    requestAnimationFrame(() => requestAnimationFrame(() => root.classList.remove("theme-switching")));
  };

  document.addEventListener("click", (e) => {
    const btn = e.target.closest && e.target.closest("[data-theme-toggle]");
    if (!btn || replaying) return;

    if (!FADE || !document.startViewTransition || calm.matches) { freeze(); return; }   // let app.js handle it as usual

    e.stopImmediatePropagation();                         // take over the click, then replay it inside the transition
    e.preventDefault();
    root.classList.add("theme-switching");
    let vt;
    try {
      vt = document.startViewTransition(() => {
        replaying = true;
        try { btn.click(); } finally { replaying = false; }
      });
    } catch (err) {
      root.classList.remove("theme-switching");
      replaying = true; try { btn.click(); } finally { replaying = false; }
      return;
    }
    vt.ready.catch(() => {});
    vt.finished.catch(() => {}).finally(() => root.classList.remove("theme-switching"));
  }, true);
})();
