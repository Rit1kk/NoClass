(function () {
    const CHEV = '<svg class="ncs-chev" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3.5 6l4.5 4.5L12.5 6"/></svg>';
    const CK = '<svg class="ncs-ck" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3.5 8.5l3 3 6-7"/></svg>';
    const isPhText = t => /^(select|choose)\b/i.test(t);
    const valD = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value');
    const idxD = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'selectedIndex');
    let current = null;            // the dropdown that is open right now
  
    function enhance(sel) {
      if (sel.dataset.ncs || sel.multiple || sel.size > 1) return;
      sel.dataset.ncs = '1';
  
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = (sel.className + ' ncs-btn').trim();
      btn.setAttribute('aria-haspopup', 'listbox');
      btn.setAttribute('aria-expanded', 'false');
      const lab = sel.getAttribute('aria-label') || (sel.labels && sel.labels[0] ? sel.labels[0].textContent.trim() : '');
      if (lab) btn.setAttribute('aria-label', lab);
      btn.innerHTML = '<span class="ncs-val"></span>' + CHEV;
      const val = btn.firstChild;
  
      sel.classList.add('ncs-native');
      sel.tabIndex = -1;
      sel.setAttribute('aria-hidden', 'true');
      sel.insertAdjacentElement('afterend', btn);
      sel.addEventListener('focus', () => btn.focus());   // clicking a <label for> still works
  
      let list = null, items = [], active = -1, buf = '', bufT;
  
      function paint() {
        const o = sel.options[sel.selectedIndex];
        val.textContent = o ? o.textContent.trim() : '';
        btn.classList.toggle('is-ph', !o || o.hidden || isPhText(val.textContent));
        btn.disabled = sel.disabled;
      }
  
      // keep the label right even when other code sets .value / .selectedIndex without firing events
      Object.defineProperty(sel, 'value', { get() { return valD.get.call(sel); }, set(v) { valD.set.call(sel, v); paint(); }, configurable: true });
      Object.defineProperty(sel, 'selectedIndex', { get() { return idxD.get.call(sel); }, set(v) { idxD.set.call(sel, v); paint(); }, configurable: true });
      sel.addEventListener('change', paint);
      new MutationObserver(paint).observe(sel, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ['disabled'] });
      if (sel.form) sel.form.addEventListener('reset', () => setTimeout(paint, 0));
      paint();
  
      function setActive(i, scroll) {
        if (active >= 0 && items[active]) items[active].classList.remove('is-active');
        active = i;
        if (i >= 0 && items[i]) {
          items[i].classList.add('is-active');
          if (scroll) items[i].scrollIntoView({ block: 'nearest' });
        }
      }
      const step = d => {
        let i = active;
        for (let n = 0; n < items.length; n++) {
          i = (i + d + items.length) % items.length;
          if (!items[i].classList.contains('is-dis')) return setActive(i, true);
        }
      };
  
      function place() {
        const r = btn.getBoundingClientRect();
        list.style.minWidth = r.width + 'px';
        list.style.maxHeight = '280px';
        let h = list.offsetHeight;
        const below = innerHeight - r.bottom - 12, above = r.top - 12;
        const up = h > below && above > below;
        const maxH = Math.max(120, Math.min(280, up ? above : below));
        list.style.maxHeight = maxH + 'px';
        h = Math.min(h, maxH);
        list.style.top = (up ? r.top - 6 - h : r.bottom + 6) + 'px';
        list.style.left = Math.max(8, Math.min(r.left, innerWidth - list.offsetWidth - 8)) + 'px';
        list.classList.toggle('up', up);
      }
  
      function open() {
        if (btn.disabled || list) return;
        if (current && current !== api) current.close();
        list = document.createElement('ul');
        list.className = 'ncs-list';
        list.setAttribute('role', 'listbox');
        items = [];
        [...sel.options].forEach((o, i) => {
          if (o.hidden) return;
          const li = document.createElement('li');
          li.className = 'ncs-opt';
          li.setAttribute('role', 'option');
          li.dataset.i = i;
          li.innerHTML = '<span></span>' + CK;
          li.firstChild.textContent = o.textContent.trim();
          if (i === sel.selectedIndex) li.setAttribute('aria-selected', 'true');
          if (o.disabled) { li.classList.add('is-dis'); li.setAttribute('aria-disabled', 'true'); }
          list.appendChild(li); items.push(li);
        });
        list.addEventListener('mousedown', e => e.preventDefault());          // keep focus on the button
        list.addEventListener('click', e => {
          e.stopPropagation();                                                 // don't trigger "click outside" handlers elsewhere
          const li = e.target.closest('.ncs-opt');
          if (li && !li.classList.contains('is-dis')) choose(+li.dataset.i);
        });
        list.addEventListener('mousemove', e => {
          const li = e.target.closest('.ncs-opt');
          if (li && !li.classList.contains('is-dis')) setActive(items.indexOf(li), false);
        });
        document.body.appendChild(list);
        place();
        let start = items.findIndex(li => li.getAttribute('aria-selected') === 'true');
        if (start < 0) start = items.findIndex(li => !li.classList.contains('is-dis'));
        setActive(start, true);
        requestAnimationFrame(() => list && list.classList.add('open'));
        btn.setAttribute('aria-expanded', 'true');
        current = api;
      }
  
      function close() {
        if (!list) return;
        const l = list; list = null; items = []; active = -1;
        l.classList.remove('open');
        setTimeout(() => l.remove(), 240);
        btn.setAttribute('aria-expanded', 'false');
        if (current === api) current = null;
      }
  
      function choose(i) {
        if (sel.selectedIndex !== i) {
          idxD.set.call(sel, i);
          paint();
          sel.dispatchEvent(new Event('input', { bubbles: true }));
          sel.dispatchEvent(new Event('change', { bubbles: true }));
        }
        close();
        btn.focus();
      }
  
      btn.addEventListener('click', () => (list ? close() : open()));
      btn.addEventListener('keydown', e => {
        const k = e.key;
        if (!list) {
          if (k === 'ArrowDown' || k === 'ArrowUp' || k === 'Enter' || k === ' ') { e.preventDefault(); open(); }
          return;
        }
        if (k === 'Escape') { e.preventDefault(); e.stopPropagation(); close(); }
        else if (k === 'Tab') close();
        else if (k === 'ArrowDown') { e.preventDefault(); step(1); }
        else if (k === 'ArrowUp') { e.preventDefault(); step(-1); }
        else if (k === 'Home') { e.preventDefault(); setActive(items.findIndex(li => !li.classList.contains('is-dis')), true); }
        else if (k === 'End') { e.preventDefault(); let j = items.length - 1; while (j > 0 && items[j].classList.contains('is-dis')) j--; setActive(j, true); }
        else if (k === 'Enter' || k === ' ') { e.preventDefault(); if (active >= 0) choose(+items[active].dataset.i); }
        else if (k.length === 1 && /\S/.test(k)) {                                // type to jump
          clearTimeout(bufT); buf += k.toLowerCase(); bufT = setTimeout(() => (buf = ''), 600);
          const j = items.findIndex(li => !li.classList.contains('is-dis') && li.textContent.trim().toLowerCase().startsWith(buf));
          if (j >= 0) setActive(j, true);
        }
      });
  
      const api = { close, isOpen: () => !!list, inside: n => !!list && (list.contains(n) || btn.contains(n)), reposition: () => list && place() };
      sel._ncs = api;
    }
  
    // close on outside press, scroll or resize
    document.addEventListener('pointerdown', e => {
      if (current && !current.inside(e.target)) current.close();
    }, true);
    addEventListener('resize', () => current && current.close());
    addEventListener('scroll', e => { if (current && !(e.target.classList && e.target.classList.contains('ncs-list'))) current.close(); }, true);
  
    // enhance what is on the page now, and anything added later (e.g. the "View as" list)
    const scan = root => {
      if (root.nodeType !== 1) return;
      if (root.matches('select')) enhance(root);
      root.querySelectorAll('select').forEach(enhance);
    };
    scan(document.body);
    new MutationObserver(ms => ms.forEach(m => m.addedNodes.forEach(scan))).observe(document.body, { childList: true, subtree: true });
  })();