// pml editor runtime — injected into slides on /edit/ routes.
// Everything it adds to the document is tagged data-pml-ui (UI chrome) or
// data-pml-runtime (injected by server) and stripped before saving.
(() => {
  const CFG = window.__PML__ || { file: '', slides: [], index: 0 };
  const slideEl = document.querySelector('.slide') || document.body.firstElementChild;
  if (!slideEl) return console.warn('pml: no .slide root found');

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

  let selected = null;
  let dirty = false;
  let commentMode = false;
  let comments = [];

  // ---------- helpers ----------

  const $ = (sel, root = document) => root.querySelector(sel);
  const el = (tag, attrs = {}, html = '') => {
    const n = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, v);
    if (html) n.innerHTML = html;
    n.setAttribute('data-pml-ui', '');
    return n;
  };
  const inTextInput = () => {
    const a = document.activeElement;
    return a && (a.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(a.tagName));
  };
  const scaleFactor = () => slideEl.getBoundingClientRect().width / 1280;

  const setDirty = (v) => {
    dirty = v;
    status.className = 'pml-dot ' + (v ? 'dirty' : 'clean');
    status.title = v ? 'Unsaved changes' : 'Saved';
  };

  // Preload all pickable fonts so the dropdown previews instantly (runtime-only).
  const fontPreload = document.createElement('link');
  fontPreload.rel = 'stylesheet';
  fontPreload.setAttribute('data-pml-runtime', '');
  fontPreload.href =
    'https://fonts.googleapis.com/css2?' +
    Object.values(GOOGLE_FONTS).map((f) => 'family=' + f).join('&') +
    '&display=swap';
  document.head.appendChild(fontPreload);

  // Persist a font into the slide file so it renders outside the editor.
  const ensureFontLink = (family) => {
    if (!GOOGLE_FONTS[family]) return;
    if ($(`link[data-pml-font="${family}"]`)) return;
    const l = document.createElement('link');
    l.rel = 'stylesheet';
    l.setAttribute('data-pml-font', family);
    l.href = 'https://fonts.googleapis.com/css2?family=' + GOOGLE_FONTS[family] + '&display=swap';
    document.head.appendChild(l);
  };

  // ---------- zoom to fit ----------

  const fit = () => {
    const s = Math.min((innerWidth - 96) / 1280, (innerHeight - 170) / 720, 1);
    document.documentElement.style.setProperty('--pml-zoom', s);
  };
  addEventListener('resize', fit);
  document.documentElement.classList.add('pml-editing');
  fit();

  // ---------- toolbar ----------

  const bar = el('div', { class: 'pml-bar' });
  bar.innerHTML = `
    <div class="pml-group">
      <a class="pml-btn" href="/" title="Deck overview">⌗</a>
      <button class="pml-btn" id="pml-prev" title="Previous slide">‹</button>
      <span class="pml-fname">${CFG.file}</span>
      <button class="pml-btn" id="pml-next" title="Next slide">›</button>
      <a class="pml-btn" href="/present?slide=${encodeURIComponent(CFG.file)}" title="Present from here">▶</a>
    </div>
    <div class="pml-group pml-typo">
      <select id="pml-font" title="Font family" disabled>
        <option value="">Font</option>
        ${Object.keys(GOOGLE_FONTS).map((f) => `<option value="${f}" style="font-family:'${f}'">${f}</option>`).join('')}
        ${SYSTEM_FONTS.map((f) => `<option value="${f}">${f}</option>`).join('')}
      </select>
      <input id="pml-size" type="number" min="6" max="400" title="Font size (px)" disabled>
      <button class="pml-btn" id="pml-bold" title="Bold" disabled><b>B</b></button>
      <button class="pml-btn" id="pml-italic" title="Italic" disabled><i>I</i></button>
      <label class="pml-swatch" title="Text color"><input id="pml-color" type="color" disabled><span>A</span></label>
      <label class="pml-swatch" title="Background color"><input id="pml-bg" type="color" disabled><span class="pml-bg-ico"></span></label>
      <button class="pml-btn" data-align="left" title="Align left" disabled>⇤</button>
      <button class="pml-btn" data-align="center" title="Align center" disabled>⇥⇤</button>
      <button class="pml-btn" data-align="right" title="Align right" disabled>⇥</button>
      <button class="pml-btn" id="pml-dup" title="Duplicate element" disabled>⧉</button>
      <button class="pml-btn" id="pml-del" title="Delete element" disabled>✕</button>
    </div>
    <div class="pml-group">
      <button class="pml-btn" id="pml-comment-mode" title="Comment mode — click slide to pin">💬</button>
      <button class="pml-btn" id="pml-panel-toggle" title="Comments panel">☰</button>
      <button class="pml-btn pml-primary" id="pml-save" title="Save (Ctrl+S)">Save</button>
      <span class="pml-dot clean" id="pml-status" title="Saved"></span>
    </div>`;
  document.body.appendChild(bar);

  const status = $('#pml-status');
  const typoControls = [...bar.querySelectorAll('.pml-typo select, .pml-typo input, .pml-typo button')];

  const hint = el('div', { class: 'pml-hint' },
    'click select · double-click edit text · drag move · arrows nudge · <b>Ctrl+S</b> save');
  document.body.appendChild(hint);

  // ---------- selection ----------

  const syncToolbar = () => {
    const on = !!selected;
    typoControls.forEach((c) => (c.disabled = !on));
    if (!on) return;
    const cs = getComputedStyle(selected);
    $('#pml-size').value = Math.round(parseFloat(cs.fontSize));
    $('#pml-font').value =
      [...Object.keys(GOOGLE_FONTS), ...SYSTEM_FONTS].find((f) =>
        cs.fontFamily.toLowerCase().includes(f.toLowerCase())
      ) || '';
    $('#pml-bold').classList.toggle('active', parseInt(cs.fontWeight) >= 600);
    $('#pml-italic').classList.toggle('active', cs.fontStyle === 'italic');
    const toHex = (rgb) => {
      const m = rgb.match(/\d+/g);
      return m ? '#' + m.slice(0, 3).map((n) => (+n).toString(16).padStart(2, '0')).join('') : '#000000';
    };
    $('#pml-color').value = toHex(cs.color);
    $('#pml-bg').value = toHex(cs.backgroundColor);
  };

  const select = (node) => {
    if (selected) selected.classList.remove('pml-selected');
    selected = node;
    if (selected) selected.classList.add('pml-selected');
    syncToolbar();
  };

  const deselect = () => {
    if (selected && selected.isContentEditable) endTextEdit(selected);
    select(null);
  };

  document.addEventListener('mousedown', (e) => {
    if (e.target.closest('[data-pml-ui]')) return;
    if (commentMode) return;
    const target = e.target.closest('.slide *:not([data-pml-ui])') ||
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
  };
  const onTextInput = () => setDirty(true);

  document.addEventListener('dblclick', (e) => {
    if (e.target.closest('[data-pml-ui]') || commentMode) return;
    const target = e.target.closest('.slide *');
    if (!target || target === slideEl) return;
    select(target);
    target.setAttribute('contenteditable', 'true');
    target.addEventListener('input', onTextInput);
    target.focus();
  });
  document.addEventListener('focusout', (e) => {
    if (e.target.isContentEditable && !e.target.hasAttribute('data-pml-ui')) endTextEdit(e.target);
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
    let moving = false, baseL = 0, baseT = 0;
    const move = (ev) => {
      const dx = ev.clientX - startX, dy = ev.clientY - startY;
      if (!moving && Math.hypot(dx, dy) < 4) return;
      if (!moving) {
        moving = true;
        makeAbsolute(node);
        baseL = parseFloat(node.style.left) || 0;
        baseT = parseFloat(node.style.top) || 0;
        document.body.classList.add('pml-dragging');
      }
      const s = scaleFactor();
      node.style.left = baseL + dx / s + 'px';
      node.style.top = baseT + dy / s + 'px';
    };
    const up = () => {
      removeEventListener('mousemove', move);
      removeEventListener('mouseup', up);
      document.body.classList.remove('pml-dragging');
      if (moving) setDirty(true);
    };
    addEventListener('mousemove', move);
    addEventListener('mouseup', up);
  };

  // ---------- toolbar actions ----------

  const applyStyle = (prop, value) => {
    if (!selected) return;
    selected.style[prop] = value;
    setDirty(true);
  };

  $('#pml-font').addEventListener('change', (e) => {
    const f = e.target.value;
    if (!f || !selected) return;
    ensureFontLink(f);
    applyStyle('fontFamily', GOOGLE_FONTS[f] ? `'${f}', sans-serif` : f);
  });
  $('#pml-size').addEventListener('input', (e) => applyStyle('fontSize', e.target.value + 'px'));
  $('#pml-bold').addEventListener('click', function () {
    if (!selected) return;
    const isBold = parseInt(getComputedStyle(selected).fontWeight) >= 600;
    applyStyle('fontWeight', isBold ? '400' : '700');
    this.classList.toggle('active', !isBold);
  });
  $('#pml-italic').addEventListener('click', function () {
    if (!selected) return;
    const isIt = getComputedStyle(selected).fontStyle === 'italic';
    applyStyle('fontStyle', isIt ? 'normal' : 'italic');
    this.classList.toggle('active', !isIt);
  });
  $('#pml-color').addEventListener('input', (e) => applyStyle('color', e.target.value));
  $('#pml-bg').addEventListener('input', (e) => applyStyle('backgroundColor', e.target.value));
  bar.querySelectorAll('[data-align]').forEach((b) =>
    b.addEventListener('click', () => applyStyle('textAlign', b.dataset.align))
  );
  $('#pml-dup').addEventListener('click', () => {
    if (!selected || selected === slideEl) return;
    const clone = selected.cloneNode(true);
    clone.classList.remove('pml-selected');
    if (clone.style.position === 'absolute') {
      clone.style.left = (parseFloat(clone.style.left) || 0) + 16 + 'px';
      clone.style.top = (parseFloat(clone.style.top) || 0) + 16 + 'px';
    }
    selected.after(clone);
    select(clone);
    setDirty(true);
  });
  $('#pml-del').addEventListener('click', () => {
    if (!selected || selected === slideEl) return;
    const n = selected;
    deselect();
    n.remove();
    setDirty(true);
  });

  const nav = (delta) => {
    const next = CFG.slides[CFG.index + delta];
    if (!next) return;
    location.href = '/edit/' + encodeURIComponent(next);
  };
  $('#pml-prev').addEventListener('click', () => nav(-1));
  $('#pml-next').addEventListener('click', () => nav(1));

  // ---------- keyboard ----------

  document.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key === 's') {
      e.preventDefault();
      return save();
    }
    if (inTextInput()) return;
    if (e.key === 'Escape') {
      if (commentMode) return toggleCommentMode();
      return deselect();
    }
    if (!selected) return;
    if (e.key === 'Delete' || e.key === 'Backspace') {
      e.preventDefault();
      return $('#pml-del').click();
    }
    const step = e.shiftKey ? 10 : 1;
    const dirs = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] };
    if (dirs[e.key] && selected !== slideEl) {
      e.preventDefault();
      makeAbsolute(selected);
      selected.style.left = (parseFloat(selected.style.left) || 0) + dirs[e.key][0] + 'px';
      selected.style.top = (parseFloat(selected.style.top) || 0) + dirs[e.key][1] + 'px';
      setDirty(true);
    }
  });

  // ---------- save ----------

  const serialize = () => {
    const clone = document.documentElement.cloneNode(true);
    clone.querySelectorAll('[data-pml-runtime], [data-pml-ui]').forEach((n) => n.remove());
    clone.querySelectorAll('[contenteditable]').forEach((n) => n.removeAttribute('contenteditable'));
    clone.querySelectorAll('.pml-selected').forEach((n) => {
      n.classList.remove('pml-selected');
      if (!n.className) n.removeAttribute('class');
    });
    clone.style.removeProperty('--pml-zoom');
    clone.classList.remove('pml-editing');
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
  $('#pml-save').addEventListener('click', save);

  const flash = (msg, bad = false) => {
    const t = el('div', { class: 'pml-toast' + (bad ? ' bad' : '') }, msg);
    document.body.appendChild(t);
    setTimeout(() => t.remove(), 2200);
  };

  addEventListener('beforeunload', (e) => {
    if (dirty) e.preventDefault();
  });

  // ---------- live reload ----------

  const reloadBar = el('div', { class: 'pml-reload-bar' },
    'File changed on disk. <button data-pml-ui id="pml-reload-yes">Reload</button><button data-pml-ui id="pml-reload-no">Keep my edits</button>');
  reloadBar.style.display = 'none';
  document.body.appendChild(reloadBar);
  $('#pml-reload-yes').addEventListener('click', () => { dirty = false; location.reload(); });
  $('#pml-reload-no').addEventListener('click', () => (reloadBar.style.display = 'none'));

  new EventSource('/events').onmessage = (e) => {
    const ev = JSON.parse(e.data);
    if (ev.type !== 'change') return;
    const mine = ev.file === 'slides/' + CFG.file;
    const theme = ev.file.endsWith('.css');
    if (mine || theme) {
      if (!dirty) location.reload();
      else if (theme) {
        document.querySelectorAll('link[rel="stylesheet"]:not([data-pml-runtime])').forEach((l) => {
          const u = new URL(l.href);
          u.searchParams.set('pml-bust', Date.now());
          l.href = u.href;
        });
      } else reloadBar.style.display = 'flex';
    }
  };

  // ---------- comments ----------

  const panel = el('div', { class: 'pml-panel' }, `
    <div class="pml-panel-head">Comments <button data-pml-ui id="pml-panel-close">✕</button></div>
    <div class="pml-panel-body" id="pml-comment-list"></div>`);
  document.body.appendChild(panel);
  $('#pml-panel-close').addEventListener('click', () => panel.classList.remove('open'));
  $('#pml-panel-toggle').addEventListener('click', () => panel.classList.toggle('open'));

  const toggleCommentMode = () => {
    commentMode = !commentMode;
    $('#pml-comment-mode').classList.toggle('active', commentMode);
    document.body.classList.toggle('pml-comment-mode', commentMode);
    if (commentMode) deselect();
  };
  $('#pml-comment-mode').addEventListener('click', toggleCommentMode);

  const renderPins = () => {
    slideEl.querySelectorAll('.pml-pin').forEach((p) => p.remove());
    comments.filter((c) => !c.resolved).forEach((c) => {
      const pin = el('div', { class: 'pml-pin', title: c.author + ': ' + c.text }, String(c.id));
      pin.style.left = c.x + '%';
      pin.style.top = c.y + '%';
      pin.addEventListener('click', (e) => {
        e.stopPropagation();
        panel.classList.add('open');
        $(`[data-cid="${c.id}"]`)?.scrollIntoView({ behavior: 'smooth' });
      });
      slideEl.appendChild(pin);
    });
  };

  const renderPanel = () => {
    const list = $('#pml-comment-list');
    if (!comments.length) {
      list.innerHTML = '<p class="pml-empty">No comments yet.<br>Toggle 💬 and click the slide to add one.</p>';
      return;
    }
    list.innerHTML = comments
      .slice()
      .sort((a, b) => a.resolved - b.resolved || b.ts - a.ts)
      .map((c) => `
        <div class="pml-comment ${c.resolved ? 'resolved' : ''}" data-cid="${c.id}">
          <div class="pml-c-head"><span class="pml-c-pin">${c.id}</span><b>${escapeHtml(c.author)}</b>
            <button data-pml-ui class="pml-c-resolve" data-id="${c.id}" title="${c.resolved ? 'Reopen' : 'Resolve'}">${c.resolved ? '↺' : '✓'}</button>
          </div>
          <div class="pml-c-text">${escapeHtml(c.text)}</div>
          ${c.replies.map((r) => `<div class="pml-c-reply"><b>${escapeHtml(r.author)}</b> ${escapeHtml(r.text)}</div>`).join('')}
          <form data-pml-ui class="pml-c-replyform" data-id="${c.id}">
            <input data-pml-ui placeholder="Reply…"><button data-pml-ui>↩</button>
          </form>
        </div>`)
      .join('');
    list.querySelectorAll('.pml-c-resolve').forEach((b) =>
      b.addEventListener('click', async () => {
        await fetch(`/api/comments/${b.dataset.id}/resolve`, { method: 'POST' });
        loadComments();
      })
    );
    list.querySelectorAll('.pml-c-replyform').forEach((f) =>
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

  const escapeHtml = (s) =>
    String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  const authorName = () => localStorage.getItem('pml-author') || 'anon';

  const loadComments = async () => {
    const res = await fetch('/api/comments?file=' + encodeURIComponent(CFG.file));
    comments = (await res.json()).comments;
    renderPins();
    renderPanel();
  };

  // Click-to-pin popover
  slideEl.addEventListener('click', (e) => {
    if (!commentMode || e.target.closest('[data-pml-ui]')) return;
    const sr = slideEl.getBoundingClientRect();
    const x = ((e.clientX - sr.left) / sr.width) * 100;
    const y = ((e.clientY - sr.top) / sr.height) * 100;
    openCommentPopover(e.clientX, e.clientY, x, y);
  });

  const openCommentPopover = (px, py, x, y) => {
    $('.pml-popover')?.remove();
    const pop = el('div', { class: 'pml-popover' }, `
      <input data-pml-ui id="pml-c-author" placeholder="Your name" value="${escapeHtml(authorName() === 'anon' ? '' : authorName())}">
      <textarea data-pml-ui id="pml-c-text" placeholder="Comment…" rows="3"></textarea>
      <div class="pml-pop-actions">
        <button data-pml-ui id="pml-c-cancel">Cancel</button>
        <button data-pml-ui id="pml-c-post" class="pml-primary">Comment</button>
      </div>`);
    pop.style.left = Math.min(px, innerWidth - 280) + 'px';
    pop.style.top = Math.min(py, innerHeight - 220) + 'px';
    document.body.appendChild(pop);
    $('#pml-c-text').focus();
    $('#pml-c-cancel').addEventListener('click', () => pop.remove());
    $('#pml-c-post').addEventListener('click', async () => {
      const author = $('#pml-c-author').value.trim() || 'anon';
      const text = $('#pml-c-text').value.trim();
      if (!text) return;
      localStorage.setItem('pml-author', author);
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

  loadComments();
  setDirty(false);
})();
