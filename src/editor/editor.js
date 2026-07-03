// lmth editor runtime — injected into slides on /edit/ routes.
// Everything it adds to the document is tagged data-lmth-ui (UI chrome) or
// data-lmth-runtime (injected by server) and stripped before saving.
// Exceptions kept in saved files: link[data-lmth-font], style[data-lmth-fx].
(() => {
  const CFG = window.__LMTH__ || { file: '', slides: [], index: 0 };
  let slideEl = document.querySelector('.slide') || document.body.firstElementChild;
  if (!slideEl) return console.warn('lmth: no .slide root found');

  const GOOGLE_FONTS = {
    Inter: 'Inter:wght@400;500;600;700;800;900',
    'Space Grotesk': 'Space+Grotesk:wght@400;500;700',
    'Playfair Display': 'Playfair+Display:ital,wght@0,400;0,700;0,900;1,400',
    'DM Serif Display': 'DM+Serif+Display:ital@0;1',
    'Bricolage Grotesque': 'Bricolage+Grotesque:wght@400;600;800',
    Outfit: 'Outfit:wght@400;600;800',
    Lora: 'Lora:ital,wght@0,400;0,700;1,400',
    'JetBrains Mono': 'JetBrains+Mono:wght@400;600',
  };
  const SYSTEM_FONTS = ['system-ui', 'Georgia', 'Arial', 'Courier New'];

  const FX_PRESETS = ['fade-in', 'fade-up', 'zoom-in', 'slide-left', 'slide-right', 'blur-in'];
  // Self-contained: this <style data-lmth-fx> is persisted into the slide file
  // so effects play anywhere the file opens — presenter, export, raw browser.
  const FX_CSS = `
[class*="fx-"]{animation-duration:.8s;animation-timing-function:cubic-bezier(.22,1,.36,1);animation-fill-mode:both;animation-delay:var(--fx-delay,0s)}
.fx-fade-in{animation-name:lmthFadeIn}
.fx-fade-up{animation-name:lmthFadeUp}
.fx-zoom-in{animation-name:lmthZoomIn}
.fx-slide-left{animation-name:lmthSlideLeft}
.fx-slide-right{animation-name:lmthSlideRight}
.fx-blur-in{animation-name:lmthBlurIn}
@keyframes lmthFadeIn{from{opacity:0}}
@keyframes lmthFadeUp{from{opacity:0;translate:0 36px}}
@keyframes lmthZoomIn{from{opacity:0;scale:.82}}
@keyframes lmthSlideLeft{from{opacity:0;translate:60px 0}}
@keyframes lmthSlideRight{from{opacity:0;translate:-60px 0}}
@keyframes lmthBlurIn{from{opacity:0;filter:blur(14px)}}
@media (prefers-reduced-motion:reduce){[class*="fx-"]{animation:none}}
`;

  const GRID = 8;      // grid snap step (slide px)
  const SNAP_DIST = 6; // smart-guide magnet distance (slide px)

  let selected = null;
  let dirty = false;
  let commentMode = false;
  let snapOn = true;
  let comments = [];

  // ---------- helpers ----------

  const $ = (sel, root = document) => root.querySelector(sel);
  const el = (tag, attrs = {}, html = '') => {
    const n = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, v);
    if (html) n.innerHTML = html;
    n.setAttribute('data-lmth-ui', '');
    return n;
  };
  const inTextInput = () => {
    const a = document.activeElement;
    return a && (a.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(a.tagName));
  };
  const scaleFactor = () => slideEl.getBoundingClientRect().width / 1280;

  const setDirty = (v) => {
    dirty = v;
    status.className = 'lmth-dot ' + (v ? 'dirty' : 'clean');
    status.title = v ? 'Unsaved changes' : 'Saved';
  };

  const escapeHtml = (s) =>
    String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  // Preload all pickable fonts so the dropdown previews instantly (runtime-only).
  const fontPreload = document.createElement('link');
  fontPreload.rel = 'stylesheet';
  fontPreload.setAttribute('data-lmth-runtime', '');
  fontPreload.href =
    'https://fonts.googleapis.com/css2?' +
    Object.values(GOOGLE_FONTS).map((f) => 'family=' + f).join('&') +
    '&display=swap';
  document.head.appendChild(fontPreload);

  // Persist a font into the slide file so it renders outside the editor.
  const ensureFontLink = (family) => {
    if (!GOOGLE_FONTS[family]) return;
    if ($(`link[data-lmth-font="${family}"]`)) return;
    const l = document.createElement('link');
    l.rel = 'stylesheet';
    l.setAttribute('data-lmth-font', family);
    l.href = 'https://fonts.googleapis.com/css2?family=' + GOOGLE_FONTS[family] + '&display=swap';
    document.head.appendChild(l);
  };

  const ensureFxStyle = () => {
    if ($('style[data-lmth-fx]')) return;
    const s = document.createElement('style');
    s.setAttribute('data-lmth-fx', '');
    s.textContent = FX_CSS;
    document.head.appendChild(s);
  };

  // ---------- undo / redo ----------

  const undoStack = [], redoStack = [];
  let lastSnapKey = '', lastSnapTime = 0;

  const cleanSlideHTML = () => {
    const c = slideEl.cloneNode(true);
    c.querySelectorAll('[data-lmth-ui]').forEach((n) => n.remove());
    c.querySelectorAll('[contenteditable]').forEach((n) => n.removeAttribute('contenteditable'));
    c.classList.remove('lmth-selected');
    if (!c.className) c.removeAttribute('class');
    return c.outerHTML;
  };

  // Throttled per action type so continuous inputs (color slider, size
  // spinner, drag) produce one undo step, not fifty.
  const snapshot = (key) => {
    const now = Date.now();
    if (key === lastSnapKey && now - lastSnapTime < 800) { lastSnapTime = now; return; }
    lastSnapKey = key;
    lastSnapTime = now;
    undoStack.push(cleanSlideHTML());
    if (undoStack.length > 60) undoStack.shift();
    redoStack.length = 0;
  };

  const restore = (html) => {
    const t = document.createElement('div');
    t.innerHTML = html;
    const fresh = t.firstElementChild;
    slideEl.replaceWith(fresh);
    slideEl = fresh;
    slideEl.appendChild(guideV);
    slideEl.appendChild(guideH);
    hideGuides();
    select(null);
    renderPins();
    setDirty(true);
  };
  const undo = () => {
    if (!undoStack.length) return flash('Nothing to undo');
    redoStack.push(cleanSlideHTML());
    restore(undoStack.pop());
    lastSnapKey = '';
  };
  const redo = () => {
    if (!redoStack.length) return flash('Nothing to redo');
    undoStack.push(cleanSlideHTML());
    restore(redoStack.pop());
    lastSnapKey = '';
  };

  // ---------- zoom to fit ----------

  const fit = () => {
    const s = Math.min((innerWidth - 96) / 1280, (innerHeight - 170) / 720, 1);
    document.documentElement.style.setProperty('--lmth-zoom', s);
    updateResizer();
  };
  addEventListener('resize', fit);
  document.documentElement.classList.add('lmth-editing');

  // ---------- toolbar ----------

  const bar = el('div', { class: 'lmth-bar' });
  bar.innerHTML = `
    <div class="lmth-group">
      <a class="lmth-btn" href="/" title="Deck overview">⌗</a>
      <button class="lmth-btn" id="lmth-prev" title="Previous slide">‹</button>
      <span class="lmth-fname">${escapeHtml(CFG.file)}</span>
      <button class="lmth-btn" id="lmth-next" title="Next slide">›</button>
      <a class="lmth-btn" href="/present?slide=${encodeURIComponent(CFG.file)}" title="Present from here">▶</a>
    </div>
    <div class="lmth-group">
      <button class="lmth-btn" id="lmth-undo" title="Undo (Ctrl+Z)">↶</button>
      <button class="lmth-btn" id="lmth-redo" title="Redo (Ctrl+Shift+Z)">↷</button>
      <button class="lmth-btn active" id="lmth-snap" title="Snap to grid & guides (hold Alt to bypass)">🧲</button>
      <div class="lmth-menu-wrap">
        <button class="lmth-btn" id="lmth-insert" title="Insert element">＋ Insert</button>
        <div class="lmth-menu" id="lmth-insert-menu">
          <button data-lmth-ui data-ins="heading">Heading</button>
          <button data-lmth-ui data-ins="text">Text</button>
          <button data-lmth-ui data-ins="bullets">Bullet list</button>
          <button data-lmth-ui data-ins="card">Card</button>
          <button data-lmth-ui data-ins="image-url">Image from URL…</button>
          <button data-lmth-ui data-ins="image-upload">Upload image…</button>
        </div>
      </div>
    </div>
    <div class="lmth-group lmth-typo">
      <select id="lmth-font" title="Font family" disabled>
        <option value="">Font</option>
        ${Object.keys(GOOGLE_FONTS).map((f) => `<option value="${f}" style="font-family:'${f}'">${f}</option>`).join('')}
        ${SYSTEM_FONTS.map((f) => `<option value="${f}">${f}</option>`).join('')}
      </select>
      <input id="lmth-size" type="number" min="6" max="400" title="Font size (px)" disabled>
      <button class="lmth-btn" id="lmth-bold" title="Bold" disabled><b>B</b></button>
      <button class="lmth-btn" id="lmth-italic" title="Italic" disabled><i>I</i></button>
      <label class="lmth-swatch" title="Text color"><input id="lmth-color" type="color" disabled><span>A</span></label>
      <label class="lmth-swatch" title="Background color"><input id="lmth-bg" type="color" disabled><span class="lmth-bg-ico"></span></label>
      <button class="lmth-btn" data-align="left" title="Align left" disabled>⇤</button>
      <button class="lmth-btn" data-align="center" title="Align center" disabled>≡</button>
      <button class="lmth-btn" data-align="right" title="Align right" disabled>⇥</button>
      <select id="lmth-fx" title="Entrance effect" disabled>
        <option value="">✨ Effect</option>
        ${FX_PRESETS.map((f) => `<option value="${f}">${f}</option>`).join('')}
      </select>
      <select id="lmth-fx-delay" title="Effect delay" disabled>
        ${['0s', '0.2s', '0.4s', '0.6s', '0.8s', '1.2s'].map((d) => `<option value="${d}">${d}</option>`).join('')}
      </select>
      <button class="lmth-btn" id="lmth-fx-play" title="Preview effects">▶︎fx</button>
      <button class="lmth-btn" id="lmth-dup" title="Duplicate element" disabled>⧉</button>
      <button class="lmth-btn" id="lmth-del" title="Delete element" disabled>✕</button>
    </div>
    <div class="lmth-group">
      <button class="lmth-btn" id="lmth-comment-mode" title="Comment mode — click slide to pin">💬</button>
      <button class="lmth-btn" id="lmth-panel-toggle" title="Comments panel">☰</button>
      <button class="lmth-btn lmth-primary" id="lmth-save" title="Save (Ctrl+S)">Save</button>
      <span class="lmth-dot clean" id="lmth-status" title="Saved"></span>
    </div>`;
  document.body.appendChild(bar);

  const status = $('#lmth-status');
  const typoControls = [...bar.querySelectorAll('.lmth-typo select, .lmth-typo input, .lmth-typo button:not(#lmth-fx-play)')];

  const hint = el('div', { class: 'lmth-hint' },
    'click select · double-click edit text · drag move · corners resize · arrows nudge · <b>Ctrl+Z</b> undo · <b>Ctrl+S</b> save');
  document.body.appendChild(hint);

  // ---------- selection + resize handles ----------

  const resizer = el('div', { class: 'lmth-resizer' }, `
    <div data-lmth-ui class="lmth-handle" data-h="e"></div>
    <div data-lmth-ui class="lmth-handle" data-h="s"></div>
    <div data-lmth-ui class="lmth-handle" data-h="se"></div>`);
  document.body.appendChild(resizer);

  function updateResizer() {
    if (!selected || selected === slideEl || selected.isContentEditable) {
      resizer.style.display = 'none';
      return;
    }
    const r = selected.getBoundingClientRect();
    resizer.style.display = 'block';
    resizer.style.left = r.left + 'px';
    resizer.style.top = r.top + 'px';
    resizer.style.width = r.width + 'px';
    resizer.style.height = r.height + 'px';
  }

  const syncToolbar = () => {
    const on = !!selected;
    typoControls.forEach((c) => (c.disabled = !on));
    if (!on) return;
    const cs = getComputedStyle(selected);
    $('#lmth-size').value = Math.round(parseFloat(cs.fontSize));
    $('#lmth-font').value =
      [...Object.keys(GOOGLE_FONTS), ...SYSTEM_FONTS].find((f) =>
        cs.fontFamily.toLowerCase().includes(f.toLowerCase())
      ) || '';
    $('#lmth-bold').classList.toggle('active', parseInt(cs.fontWeight) >= 600);
    $('#lmth-italic').classList.toggle('active', cs.fontStyle === 'italic');
    const toHex = (rgb) => {
      const m = rgb.match(/\d+/g);
      return m ? '#' + m.slice(0, 3).map((n) => (+n).toString(16).padStart(2, '0')).join('') : '#000000';
    };
    $('#lmth-color').value = toHex(cs.color);
    $('#lmth-bg').value = toHex(cs.backgroundColor);
    $('#lmth-fx').value = FX_PRESETS.find((f) => selected.classList.contains('fx-' + f)) || '';
    $('#lmth-fx-delay').value = selected.style.getPropertyValue('--fx-delay') || '0s';
  };

  const select = (node) => {
    if (selected) selected.classList.remove('lmth-selected');
    selected = node;
    if (selected) selected.classList.add('lmth-selected');
    syncToolbar();
    updateResizer();
  };

  const deselect = () => {
    if (selected && selected.isContentEditable) endTextEdit(selected);
    select(null);
  };

  document.addEventListener('mousedown', (e) => {
    if (e.target.closest('[data-lmth-ui]')) return;
    if (commentMode) return;
    const target = e.target.closest('.slide *:not([data-lmth-ui])') ||
      (e.target.closest('.slide') ? slideEl : null);
    if (!target) return deselect();
    if (target !== selected) {
      if (selected && selected.isContentEditable) endTextEdit(selected);
      select(target);
    }
    if (target !== slideEl && !target.isContentEditable) startDrag(e, target);
  });

  // ---------- inline text editing ----------

  const endTextEdit = (node) => {
    node.removeAttribute('contenteditable');
    node.removeEventListener('input', onTextInput);
    updateResizer();
  };
  const onTextInput = () => setDirty(true);

  document.addEventListener('dblclick', (e) => {
    if (e.target.closest('[data-lmth-ui]') || commentMode) return;
    const target = e.target.closest('.slide *');
    if (!target || target === slideEl) return;
    snapshot('text:' + Math.random()); // each edit session = own undo step
    select(target);
    target.setAttribute('contenteditable', 'true');
    target.addEventListener('input', onTextInput);
    target.focus();
    updateResizer();
  });
  document.addEventListener('focusout', (e) => {
    if (e.target.isContentEditable && !e.target.hasAttribute('data-lmth-ui')) endTextEdit(e.target);
  });

  // ---------- snap: grid + smart guides ----------

  const guideV = el('div', { class: 'lmth-guide v' });
  const guideH = el('div', { class: 'lmth-guide h' });
  slideEl.appendChild(guideV);
  slideEl.appendChild(guideH);
  const hideGuides = () => { guideV.style.display = 'none'; guideH.style.display = 'none'; };
  hideGuides();

  // Snap targets in slide-space: slide edges/center + sibling edges/centers.
  const snapTargets = (node) => {
    const xs = [0, 640, 1280], ys = [0, 360, 720];
    const s = scaleFactor();
    const sr = slideEl.getBoundingClientRect();
    for (const sib of slideEl.children) {
      if (sib === node || sib.hasAttribute('data-lmth-ui')) continue;
      const r = sib.getBoundingClientRect();
      const L = (r.left - sr.left) / s, T = (r.top - sr.top) / s;
      xs.push(L, L + r.width / s / 2, L + r.width / s);
      ys.push(T, T + r.height / s / 2, T + r.height / s);
    }
    return { xs, ys };
  };

  // Given proposed left/top (slide-space), return snapped position + guides.
  const applySnap = (node, left, top, w, h, targets) => {
    let gx = null, gy = null;
    const edgesX = [left, left + w / 2, left + w];
    const edgesY = [top, top + h / 2, top + h];
    outer: for (const t of targets.xs) {
      for (let i = 0; i < 3; i++) {
        if (Math.abs(edgesX[i] - t) < SNAP_DIST) { left += t - edgesX[i]; gx = t; break outer; }
      }
    }
    outer2: for (const t of targets.ys) {
      for (let i = 0; i < 3; i++) {
        if (Math.abs(edgesY[i] - t) < SNAP_DIST) { top += t - edgesY[i]; gy = t; break outer2; }
      }
    }
    if (gx === null) left = Math.round(left / GRID) * GRID;
    if (gy === null) top = Math.round(top / GRID) * GRID;
    guideV.style.display = gx === null ? 'none' : 'block';
    guideH.style.display = gy === null ? 'none' : 'block';
    if (gx !== null) guideV.style.left = gx + 'px';
    if (gy !== null) guideH.style.top = gy + 'px';
    return { left, top };
  };

  $('#lmth-snap').addEventListener('click', function () {
    snapOn = !snapOn;
    this.classList.toggle('active', snapOn);
  });

  // ---------- drag to move ----------

  const makeAbsolute = (node) => {
    const cs = getComputedStyle(node);
    if (cs.position === 'absolute' || cs.position === 'fixed') return;
    const s = scaleFactor();
    const nr = node.getBoundingClientRect();
    const sr = slideEl.getBoundingClientRect();
    node.style.width = nr.width / s + 'px';
    node.style.position = 'absolute';
    node.style.left = (nr.left - sr.left) / s + 'px';
    node.style.top = (nr.top - sr.top) / s + 'px';
    node.style.margin = '0';
  };

  const startDrag = (e, node) => {
    const startX = e.clientX, startY = e.clientY;
    let moving = false, baseL = 0, baseT = 0, targets = null, w = 0, h = 0;
    const move = (ev) => {
      const dx = ev.clientX - startX, dy = ev.clientY - startY;
      if (!moving && Math.hypot(dx, dy) < 4) return;
      if (!moving) {
        moving = true;
        snapshot('drag:' + Math.random());
        makeAbsolute(node);
        baseL = parseFloat(node.style.left) || 0;
        baseT = parseFloat(node.style.top) || 0;
        const s0 = scaleFactor();
        const r0 = node.getBoundingClientRect();
        w = r0.width / s0;
        h = r0.height / s0;
        targets = snapTargets(node);
        document.body.classList.add('lmth-dragging');
      }
      const s = scaleFactor();
      let left = baseL + dx / s, top = baseT + dy / s;
      if (snapOn && !ev.altKey) ({ left, top } = applySnap(node, left, top, w, h, targets));
      else hideGuides();
      node.style.left = left + 'px';
      node.style.top = top + 'px';
      updateResizer();
    };
    const up = () => {
      removeEventListener('mousemove', move);
      removeEventListener('mouseup', up);
      document.body.classList.remove('lmth-dragging');
      hideGuides();
      if (moving) { setDirty(true); updateResizer(); }
    };
    addEventListener('mousemove', move);
    addEventListener('mouseup', up);
  };

  // ---------- resize via handles ----------

  resizer.addEventListener('mousedown', (e) => {
    const handle = e.target.closest('.lmth-handle');
    if (!handle || !selected) return;
    e.preventDefault();
    e.stopPropagation();
    const dir = handle.dataset.h;
    const node = selected;
    snapshot('resize:' + Math.random());
    const s = scaleFactor();
    const r = node.getBoundingClientRect();
    const startW = r.width / s, startH = r.height / s;
    const startX = e.clientX, startY = e.clientY;
    document.body.classList.add('lmth-dragging');
    const move = (ev) => {
      const sc = scaleFactor();
      if (dir.includes('e')) {
        let w = startW + (ev.clientX - startX) / sc;
        if (snapOn && !ev.altKey) w = Math.round(w / GRID) * GRID;
        node.style.width = Math.max(24, w) + 'px';
      }
      if (dir.includes('s')) {
        let h = startH + (ev.clientY - startY) / sc;
        if (snapOn && !ev.altKey) h = Math.round(h / GRID) * GRID;
        node.style.height = Math.max(24, h) + 'px';
      }
      updateResizer();
    };
    const up = () => {
      removeEventListener('mousemove', move);
      removeEventListener('mouseup', up);
      document.body.classList.remove('lmth-dragging');
      setDirty(true);
      updateResizer();
    };
    addEventListener('mousemove', move);
    addEventListener('mouseup', up);
  });

  // ---------- toolbar actions ----------

  const applyStyle = (prop, value, snapKey = 'style:' + prop) => {
    if (!selected) return;
    snapshot(snapKey);
    selected.style[prop] = value;
    setDirty(true);
    updateResizer();
  };

  $('#lmth-font').addEventListener('change', (e) => {
    const f = e.target.value;
    if (!f || !selected) return;
    ensureFontLink(f);
    applyStyle('fontFamily', GOOGLE_FONTS[f] ? `'${f}', sans-serif` : f);
  });
  $('#lmth-size').addEventListener('input', (e) => applyStyle('fontSize', e.target.value + 'px'));
  $('#lmth-bold').addEventListener('click', function () {
    if (!selected) return;
    const isBold = parseInt(getComputedStyle(selected).fontWeight) >= 600;
    applyStyle('fontWeight', isBold ? '400' : '700');
    this.classList.toggle('active', !isBold);
  });
  $('#lmth-italic').addEventListener('click', function () {
    if (!selected) return;
    const isIt = getComputedStyle(selected).fontStyle === 'italic';
    applyStyle('fontStyle', isIt ? 'normal' : 'italic');
    this.classList.toggle('active', !isIt);
  });
  $('#lmth-color').addEventListener('input', (e) => applyStyle('color', e.target.value));
  $('#lmth-bg').addEventListener('input', (e) => applyStyle('backgroundColor', e.target.value));
  bar.querySelectorAll('[data-align]').forEach((b) =>
    b.addEventListener('click', () => applyStyle('textAlign', b.dataset.align))
  );

  $('#lmth-fx').addEventListener('change', (e) => {
    if (!selected) return;
    snapshot('fx');
    FX_PRESETS.forEach((f) => selected.classList.remove('fx-' + f));
    if (e.target.value) {
      ensureFxStyle();
      selected.classList.add('fx-' + e.target.value);
      selected.style.setProperty('--fx-delay', $('#lmth-fx-delay').value);
      replayFx();
    }
    if (!selected.className.trim()) selected.removeAttribute('class');
    setDirty(true);
  });
  $('#lmth-fx-delay').addEventListener('change', (e) => {
    if (!selected) return;
    snapshot('fx');
    selected.style.setProperty('--fx-delay', e.target.value);
    setDirty(true);
  });
  const replayFx = () => {
    slideEl.querySelectorAll('[class*="fx-"]').forEach((n) =>
      n.getAnimations().forEach((a) => { a.cancel(); a.play(); })
    );
  };
  $('#lmth-fx-play').addEventListener('click', replayFx);

  $('#lmth-dup').addEventListener('click', () => {
    if (!selected || selected === slideEl) return;
    snapshot('dup:' + Math.random());
    const clone = selected.cloneNode(true);
    clone.classList.remove('lmth-selected');
    if (clone.style.position === 'absolute') {
      clone.style.left = (parseFloat(clone.style.left) || 0) + 16 + 'px';
      clone.style.top = (parseFloat(clone.style.top) || 0) + 16 + 'px';
    }
    selected.after(clone);
    select(clone);
    setDirty(true);
  });
  $('#lmth-del').addEventListener('click', () => {
    if (!selected || selected === slideEl) return;
    snapshot('del:' + Math.random());
    const n = selected;
    deselect();
    n.remove();
    setDirty(true);
  });

  $('#lmth-undo').addEventListener('click', undo);
  $('#lmth-redo').addEventListener('click', redo);

  const nav = (delta) => {
    const next = CFG.slides[CFG.index + delta];
    if (!next) return;
    location.href = '/edit/' + encodeURIComponent(next);
  };
  $('#lmth-prev').addEventListener('click', () => nav(-1));
  $('#lmth-next').addEventListener('click', () => nav(1));

  // ---------- insert menu ----------

  const insertMenu = $('#lmth-insert-menu');
  $('#lmth-insert').addEventListener('click', (e) => {
    e.stopPropagation();
    insertMenu.classList.toggle('open');
  });
  document.addEventListener('click', (e) => {
    if (!e.target.closest('.lmth-menu-wrap')) insertMenu.classList.remove('open');
  });

  let insertOffset = 0;
  const placeNew = (node) => {
    node.style.position = 'absolute';
    node.style.left = 120 + insertOffset + 'px';
    node.style.top = 120 + insertOffset + 'px';
    insertOffset = (insertOffset + 24) % 240;
    slideEl.appendChild(node);
    select(node);
    setDirty(true);
  };

  const INSERTS = {
    heading() {
      const n = document.createElement('h2');
      n.textContent = 'New heading';
      n.style.cssText = 'font-size:48px;font-weight:700;margin:0;max-width:900px';
      return n;
    },
    text() {
      const n = document.createElement('p');
      n.textContent = 'New text. Double-click to edit.';
      n.style.cssText = 'font-size:24px;margin:0;max-width:700px;line-height:1.6';
      return n;
    },
    bullets() {
      const n = document.createElement('ul');
      n.innerHTML = '<li>First point</li><li>Second point</li><li>Third point</li>';
      n.style.cssText = 'font-size:24px;line-height:1.9;margin:0;padding-left:28px';
      return n;
    },
    card() {
      const n = document.createElement('div');
      n.innerHTML = '<h3 style="margin:0 0 8px;font-size:22px">Card title</h3><p style="margin:0;font-size:16px;opacity:.7;line-height:1.6">Card body text. Double-click to edit.</p>';
      n.style.cssText = 'background:rgba(255,255,255,.06);border:1px solid rgba(255,255,255,.14);border-radius:16px;padding:24px 28px;width:340px';
      return n;
    },
  };

  const insertImage = (src) => {
    const n = document.createElement('img');
    n.src = src;
    n.alt = '';
    n.style.cssText = 'width:420px;height:auto;border-radius:12px';
    placeNew(n);
  };

  const uploadInput = el('input', { type: 'file', accept: 'image/*', style: 'display:none' });
  document.body.appendChild(uploadInput);
  uploadInput.addEventListener('change', () => {
    const f = uploadInput.files[0];
    if (!f) return;
    const reader = new FileReader();
    reader.onload = async () => {
      try {
        const res = await fetch('/api/upload', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name: f.name, data: reader.result }),
        });
        const out = await res.json();
        if (!res.ok) throw new Error(out.error);
        snapshot('insert:' + Math.random());
        insertImage('../' + out.path);
      } catch (e) {
        flash('Upload failed: ' + e.message, true);
      }
      uploadInput.value = '';
    };
    reader.readAsDataURL(f);
  });

  insertMenu.addEventListener('click', (e) => {
    const b = e.target.closest('[data-ins]');
    if (!b) return;
    insertMenu.classList.remove('open');
    const kind = b.dataset.ins;
    if (kind === 'image-upload') return uploadInput.click();
    if (kind === 'image-url') {
      return openTextPrompt('Image URL', 'https://…', (url) => {
        if (url) { snapshot('insert:' + Math.random()); insertImage(url); }
      });
    }
    snapshot('insert:' + Math.random());
    placeNew(INSERTS[kind]());
  });

  // Small inline prompt (browser dialogs are avoided on purpose).
  const openTextPrompt = (label, placeholder, cb) => {
    $('.lmth-popover')?.remove();
    const pop = el('div', { class: 'lmth-popover' }, `
      <label data-lmth-ui style="font-size:12px;color:#8b8ba3">${escapeHtml(label)}</label>
      <input data-lmth-ui id="lmth-prompt-in" placeholder="${escapeHtml(placeholder)}">
      <div class="lmth-pop-actions">
        <button data-lmth-ui id="lmth-prompt-cancel">Cancel</button>
        <button data-lmth-ui id="lmth-prompt-ok" class="lmth-primary">OK</button>
      </div>`);
    pop.style.left = '50%';
    pop.style.top = '80px';
    pop.style.transform = 'translateX(-50%)';
    document.body.appendChild(pop);
    const input = $('#lmth-prompt-in');
    input.focus();
    const done = (v) => { pop.remove(); cb(v); };
    $('#lmth-prompt-cancel').addEventListener('click', () => done(null));
    $('#lmth-prompt-ok').addEventListener('click', () => done(input.value.trim()));
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') done(input.value.trim());
      if (e.key === 'Escape') done(null);
    });
  };

  // ---------- keyboard ----------

  document.addEventListener('keydown', (e) => {
    const mod = e.ctrlKey || e.metaKey;
    if (mod && e.key === 's') { e.preventDefault(); return save(); }
    if (inTextInput()) return;
    if (mod && !e.shiftKey && e.key === 'z') { e.preventDefault(); return undo(); }
    if (mod && (e.key === 'y' || (e.shiftKey && (e.key === 'z' || e.key === 'Z')))) { e.preventDefault(); return redo(); }
    if (mod && e.key === 'd' && selected) { e.preventDefault(); return $('#lmth-dup').click(); }
    if (e.key === 'Escape') {
      if (commentMode) return toggleCommentMode();
      return deselect();
    }
    if (!selected) return;
    if (e.key === 'Delete' || e.key === 'Backspace') {
      e.preventDefault();
      return $('#lmth-del').click();
    }
    const step = e.shiftKey ? 10 : 1;
    const dirs = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] };
    if (dirs[e.key] && selected !== slideEl) {
      e.preventDefault();
      snapshot('nudge');
      makeAbsolute(selected);
      selected.style.left = (parseFloat(selected.style.left) || 0) + dirs[e.key][0] + 'px';
      selected.style.top = (parseFloat(selected.style.top) || 0) + dirs[e.key][1] + 'px';
      setDirty(true);
      updateResizer();
    }
  });

  // ---------- save ----------

  const serialize = () => {
    const clone = document.documentElement.cloneNode(true);
    clone.querySelectorAll('[data-lmth-runtime], [data-lmth-ui]').forEach((n) => n.remove());
    clone.querySelectorAll('[contenteditable]').forEach((n) => n.removeAttribute('contenteditable'));
    clone.querySelectorAll('.lmth-selected').forEach((n) => {
      n.classList.remove('lmth-selected');
      if (!n.className) n.removeAttribute('class');
    });
    clone.style.removeProperty('--lmth-zoom');
    clone.classList.remove('lmth-editing');
    if (!clone.className) clone.removeAttribute('class');
    if (!clone.getAttribute('style')) clone.removeAttribute('style');
    return '<!doctype html>\n' + clone.outerHTML + '\n';
  };

  const save = async () => {
    try {
      const res = await fetch('/api/save', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ file: CFG.file, html: serialize() }),
      });
      if (!res.ok) throw new Error((await res.json()).error || res.status);
      setDirty(false);
      flash('Saved ✓');
    } catch (e) {
      flash('Save failed: ' + e.message, true);
    }
  };
  $('#lmth-save').addEventListener('click', save);

  const flash = (msg, bad = false) => {
    const t = el('div', { class: 'lmth-toast' + (bad ? ' bad' : '') }, msg);
    document.body.appendChild(t);
    setTimeout(() => t.remove(), 2200);
  };

  addEventListener('beforeunload', (e) => {
    if (dirty) e.preventDefault();
  });

  // ---------- live reload ----------

  const reloadBar = el('div', { class: 'lmth-reload-bar' },
    'File changed on disk. <button data-lmth-ui id="lmth-reload-yes">Reload</button><button data-lmth-ui id="lmth-reload-no">Keep my edits</button>');
  reloadBar.style.display = 'none';
  document.body.appendChild(reloadBar);
  $('#lmth-reload-yes').addEventListener('click', () => { dirty = false; location.reload(); });
  $('#lmth-reload-no').addEventListener('click', () => (reloadBar.style.display = 'none'));

  new EventSource('/events').onmessage = (e) => {
    const ev = JSON.parse(e.data);
    if (ev.type !== 'change') return;
    const mine = ev.file === 'slides/' + CFG.file;
    const theme = ev.file.endsWith('.css');
    if (mine || theme) {
      if (!dirty) location.reload();
      else if (theme) {
        document.querySelectorAll('link[rel="stylesheet"]:not([data-lmth-runtime])').forEach((l) => {
          const u = new URL(l.href);
          u.searchParams.set('lmth-bust', Date.now());
          l.href = u.href;
        });
      } else reloadBar.style.display = 'flex';
    }
  };

  // ---------- comments ----------

  const panel = el('div', { class: 'lmth-panel' }, `
    <div class="lmth-panel-head">Comments <button data-lmth-ui id="lmth-panel-close">✕</button></div>
    <div class="lmth-panel-body" id="lmth-comment-list"></div>`);
  document.body.appendChild(panel);
  $('#lmth-panel-close').addEventListener('click', () => panel.classList.remove('open'));
  $('#lmth-panel-toggle').addEventListener('click', () => panel.classList.toggle('open'));

  const toggleCommentMode = () => {
    commentMode = !commentMode;
    $('#lmth-comment-mode').classList.toggle('active', commentMode);
    document.body.classList.toggle('lmth-comment-mode', commentMode);
    if (commentMode) deselect();
  };
  $('#lmth-comment-mode').addEventListener('click', toggleCommentMode);

  function renderPins() {
    slideEl.querySelectorAll('.lmth-pin').forEach((p) => p.remove());
    comments.filter((c) => !c.resolved).forEach((c) => {
      const pin = el('div', { class: 'lmth-pin', title: c.author + ': ' + c.text }, String(c.id));
      pin.style.left = c.x + '%';
      pin.style.top = c.y + '%';
      pin.addEventListener('click', (e) => {
        e.stopPropagation();
        panel.classList.add('open');
        $(`[data-cid="${c.id}"]`)?.scrollIntoView({ behavior: 'smooth' });
      });
      slideEl.appendChild(pin);
    });
  }

  const renderPanel = () => {
    const list = $('#lmth-comment-list');
    if (!comments.length) {
      list.innerHTML = '<p class="lmth-empty">No comments yet.<br>Toggle 💬 and click the slide to add one.</p>';
      return;
    }
    list.innerHTML = comments
      .slice()
      .sort((a, b) => a.resolved - b.resolved || b.ts - a.ts)
      .map((c) => `
        <div class="lmth-comment ${c.resolved ? 'resolved' : ''}" data-cid="${c.id}">
          <div class="lmth-c-head"><span class="lmth-c-pin">${c.id}</span><b>${escapeHtml(c.author)}</b>
            <button data-lmth-ui class="lmth-c-resolve" data-id="${c.id}" title="${c.resolved ? 'Reopen' : 'Resolve'}">${c.resolved ? '↺' : '✓'}</button>
          </div>
          <div class="lmth-c-text">${escapeHtml(c.text)}</div>
          ${c.replies.map((r) => `<div class="lmth-c-reply"><b>${escapeHtml(r.author)}</b> ${escapeHtml(r.text)}</div>`).join('')}
          <form data-lmth-ui class="lmth-c-replyform" data-id="${c.id}">
            <input data-lmth-ui placeholder="Reply…"><button data-lmth-ui>↩</button>
          </form>
        </div>`)
      .join('');
    list.querySelectorAll('.lmth-c-resolve').forEach((b) =>
      b.addEventListener('click', async () => {
        await fetch(`/api/comments/${b.dataset.id}/resolve`, { method: 'POST' });
        loadComments();
      })
    );
    list.querySelectorAll('.lmth-c-replyform').forEach((f) =>
      f.addEventListener('submit', async (e) => {
        e.preventDefault();
        const text = f.querySelector('input').value.trim();
        if (!text) return;
        await fetch(`/api/comments/${f.dataset.id}/reply`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ author: authorName(), text }),
        });
        loadComments();
      })
    );
  };

  const authorName = () => localStorage.getItem('lmth-author') || 'anon';

  const loadComments = async () => {
    const res = await fetch('/api/comments?file=' + encodeURIComponent(CFG.file));
    comments = (await res.json()).comments;
    renderPins();
    renderPanel();
  };

  // Click-to-pin popover (document-level: slideEl can be swapped by undo/redo)
  document.addEventListener('click', (e) => {
    if (!commentMode || e.target.closest('[data-lmth-ui]') || !e.target.closest('.slide')) return;
    const sr = slideEl.getBoundingClientRect();
    const x = ((e.clientX - sr.left) / sr.width) * 100;
    const y = ((e.clientY - sr.top) / sr.height) * 100;
    openCommentPopover(e.clientX, e.clientY, x, y);
  });

  const openCommentPopover = (px, py, x, y) => {
    $('.lmth-popover')?.remove();
    const pop = el('div', { class: 'lmth-popover' }, `
      <input data-lmth-ui id="lmth-c-author" placeholder="Your name" value="${escapeHtml(authorName() === 'anon' ? '' : authorName())}">
      <textarea data-lmth-ui id="lmth-c-text" placeholder="Comment…" rows="3"></textarea>
      <div class="lmth-pop-actions">
        <button data-lmth-ui id="lmth-c-cancel">Cancel</button>
        <button data-lmth-ui id="lmth-c-post" class="lmth-primary">Comment</button>
      </div>`);
    pop.style.left = Math.min(px, innerWidth - 280) + 'px';
    pop.style.top = Math.min(py, innerHeight - 220) + 'px';
    document.body.appendChild(pop);
    $('#lmth-c-text').focus();
    $('#lmth-c-cancel').addEventListener('click', () => pop.remove());
    $('#lmth-c-post').addEventListener('click', async () => {
      const author = $('#lmth-c-author').value.trim() || 'anon';
      const text = $('#lmth-c-text').value.trim();
      if (!text) return;
      localStorage.setItem('lmth-author', author);
      await fetch('/api/comments', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ file: CFG.file, x, y, author, text }),
      });
      pop.remove();
      toggleCommentMode();
      loadComments();
      panel.classList.add('open');
    });
  };

  fit();
  loadComments();
  setDirty(false);
})();
