import { getMyClass } from './classopts.js';

const pill  = document.getElementById('cn-pill');
const label = document.getElementById('cn-label');
const card  = document.getElementById('classpick');

const LS_CLASS = 'noclass-myclass';   // same key classopts.js uses
const LS_SEEN  = 'noclass-cn-seen';   // first-visit hint shown once

if (pill && card) {
  const panel = document.createElement('div');
  panel.className = 'cn-panel';
  panel.id = 'cn-panel';
  panel.inert = true;
  panel.innerHTML = `
    <div class="cn-sheet">
      <button type="button" class="cn-close" aria-label="Close">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><path d="M6 6l12 12M18 6 6 18"/></svg>
      </button>
      <div class="cn-slot"></div>
      <div class="cn-foot"><button type="button" class="cn-clear">Clear my class</button></div>
    </div>`;
  document.body.appendChild(panel);
  const slot = panel.querySelector('.cn-slot');
  slot.appendChild(card);

  const isOpen = () => panel.classList.contains('open');
  const hasClass = () => { const c = getMyClass(); return !!(c && c.branch); };

  function position() {
    const host = pill.closest('nav, header');
    const bottom = (host || pill).getBoundingClientRect().bottom;
    panel.style.top = Math.round(bottom + 10) + 'px';
  }

  /* ---------- pill label + first-visit hint ---------- */
  function seen()    { try { return !!localStorage.getItem(LS_SEEN); } catch { return true; } }
  function markSeen(){ try { localStorage.setItem(LS_SEEN, '1'); } catch {} pill.classList.remove('cn-pulse'); }

  function updateLabel() {
    const c = getMyClass();
    const has = !!(c && c.branch);
    label.textContent = has
      ? [c.branch, c.semester && 'Sem ' + c.semester, c.section].filter(Boolean).join(' · ')
      : 'Select your class';
    pill.classList.toggle('cn-new', !has);
    pill.classList.toggle('cn-pulse', !has && !seen());
    panel.classList.toggle('has-class', has);
  }

  /* ---------- placeholders ---------- */
  const isPh = o => /^(choose|select)\b/i.test(o.textContent.trim());
  const selects = () => [...card.querySelectorAll('select')];
  const branchSel = () => selects()[0];
  const branchPh = () => { const s = branchSel(); return s ? [...s.options].find(isPh) : null; };

  function tidySelects() {
    selects().forEach((sel, i) => {
      const phs = [...sel.options].filter(isPh);
      if (!phs.length) return;
      phs.slice(1).forEach(o => o.remove());
      const want = i === 0 ? 'Select branch' : 'Select';
      if (phs[0].textContent !== want) phs[0].textContent = want;
      if (i === 0) { phs[0].hidden = true; phs[0].disabled = true; }
    });
  }
  new MutationObserver(tidySelects).observe(card, { childList: true, subtree: true });
  tidySelects();

  /* ---------- 1. revert unsaved changes ---------- */
  function setSel(sel, val) {
    if (!sel) return;
    const opts = [...sel.options];
    const v = val == null ? '' : String(val);
    let i = v === '' ? -1 : opts.findIndex(o => !isPh(o) && (o.value === v || o.textContent.trim() === v));
    if (i < 0) { const ph = opts.find(isPh); i = ph ? ph.index : 0; }
    sel.selectedIndex = i;
    sel.dispatchEvent(new Event('change', { bubbles: true })); // lets dependent dropdowns rebuild
  }
  function syncToSaved() {
    const c = getMyClass() || {};
    const [b, s, sec] = selects();
    setSel(b, c.branch);     // branch first, the others may depend on it
    setSel(s, c.semester);
    setSel(sec, c.section);
  }

  function setOpen(open) {
    if (open) {
      position(); tidySelects(); syncToSaved(); markSeen();
    } else {
      setTimeout(() => { if (!isOpen()) syncToSaved(); }, 520); // after the close animation
    }
    panel.classList.toggle('open', open);
    pill.setAttribute('aria-expanded', open);
    panel.inert = !open;
  }

  pill.addEventListener('click', () => setOpen(!isOpen()));
  panel.querySelector('.cn-close').addEventListener('click', () => setOpen(false));
  document.addEventListener('keydown', e => { if (e.key === 'Escape' && isOpen()) setOpen(false); });
  document.addEventListener('click', e => {
    if (!isOpen()) return;
    const path = e.composedPath();   // the click's path as it was, even if the button was removed since
    if (!path.includes(panel) && !path.includes(pill)) setOpen(false);
  });
  window.addEventListener('resize', () => { if (isOpen()) position(); });

  slot.addEventListener('click', e => {
    const b = e.target.closest('button');
    if (b && b.textContent.trim().toLowerCase() === 'cancel') setOpen(false);
  }, true);   // run before the card re-renders

  // Save is blocked until a real branch is chosen
  // Save is blocked until a real branch is chosen
  slot.addEventListener('click', e => {
    const b = e.target.closest('button');
    const sel = branchSel(), ph = branchPh();
    if (b && /save/i.test(b.textContent) && sel && ph && sel.selectedIndex === ph.index) {
      e.preventDefault(); e.stopPropagation();
      // shake the visible custom button if there is one, otherwise the plain select
      const t = sel.nextElementSibling && sel.nextElementSibling.classList.contains('ncs-btn')
        ? sel.nextElementSibling : sel;
      t.classList.remove('cn-shake'); void t.offsetWidth; t.classList.add('cn-shake');
    }
  }, true);
  /* ---------- 2. clear my class ---------- */
  panel.querySelector('.cn-clear').addEventListener('click', () => {
    try { localStorage.removeItem(LS_CLASS); } catch {}
    // same event the rest of the site already listens to
    document.dispatchEvent(new CustomEvent('noclass:myclass', { bubbles: true }));
  });
  let toastTimer;
  function toast(msg) {
    let t = document.getElementById('cn-toast');
    if (!t) {
      t = document.createElement('div');
      t.id = 'cn-toast';
      t.setAttribute('role', 'status');
      document.body.appendChild(t);
    }
    t.textContent = msg;
    void t.offsetWidth;                 // restart the animation
    t.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => t.classList.remove('show'), 3200);
  }
  // after Save or Clear: refresh label and close
  window.addEventListener('noclass:myclass', () => {
    updateLabel(); setOpen(false);
    if (hasClass()) toast('Saved. Your teachers and updates now show first.');
  });
  updateLabel();
}