// pml server — zero-dependency presentation server.
// Two modes:
//   deck mode : serve one deck (dir with slides/)
//   hub mode  : serve a folder of decks — hub page at /, decks at /d/<name>/
// Adds visual editor injection, SSE live-reload, save/comments/upload APIs,
// deck + slide management, single-file export.

import http from 'node:http';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const EDITOR_DIR = path.resolve(__dirname, '../editor');
const TEMPLATE_DIR = path.resolve(__dirname, '../../templates/deck');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
};

const esc = (s) =>
  String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const FAVICON = `<link rel="icon" href="data:image/svg+xml,${encodeURIComponent(
  `<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 64 64'><defs><linearGradient id='g' x1='0' y1='0' x2='1' y2='1'><stop offset='0' stop-color='%237c6cff'/><stop offset='1' stop-color='%23ff6ec7'/></linearGradient></defs><rect width='64' height='64' rx='14' fill='url(%23g)'/><text x='32' y='44' font-family='monospace' font-size='34' font-weight='700' text-anchor='middle' fill='%230a0a0f'>p</text></svg>`
)}">`;

const BLANK_SLIDE = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>New slide</title>
<link rel="stylesheet" href="../theme.css">
</head>
<body>
<div class="slide">
  <p class="kicker">Section</p>
  <h2 class="heading">New slide</h2>
  <p class="subtitle">Double-click to edit, or use ＋ Insert in the toolbar.</p>
</div>
</body>
</html>
`;

// JSON destined for inline <script> — guard against </script> breakout.
const jsonForScript = (obj) => JSON.stringify(obj).replace(/<\/script/gi, '<\\/script');

const isDeck = (dir) => fs.existsSync(path.join(dir, 'slides'));
const slugify = (s) =>
  String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 48) || 'deck';

export async function startServer({ deckDir, port = 4321 }) {
  const rootDir = path.resolve(deckDir);
  if (!fs.existsSync(rootDir)) throw new Error(`No such directory: ${rootDir}`);

  const hubMode = !isDeck(rootDir);
  const listDecks = () =>
    hubMode
      ? fs.readdirSync(rootDir, { withFileTypes: true })
          .filter((d) => d.isDirectory() && !d.name.startsWith('.') && isDeck(path.join(rootDir, d.name)))
          .map((d) => d.name)
          .sort()
      : [''];
  if (hubMode && !listDecks().length && !fs.existsSync(TEMPLATE_DIR)) {
    throw new Error(`Not a pml deck and no decks inside: ${rootDir}. Run \`pml new <name>\` first.`);
  }

  const sseClients = new Set();
  const ownWrites = new Map(); // abs path -> timestamp of our own write

  // ---------- deck context ----------

  const ctxFor = (name) => {
    const dir = hubMode ? path.join(rootDir, name) : rootDir;
    if (hubMode && (!name || name.includes('..') || name.includes('/') || !isDeck(dir))) return null;
    return {
      name,
      dir,
      slidesDir: path.join(dir, 'slides'),
      base: hubMode ? `/d/${encodeURIComponent(name)}` : '',
      evPrefix: hubMode ? name + '/' : '',
    };
  };

  const deckMeta = async (ctx) => {
    try {
      return JSON.parse(await fsp.readFile(path.join(ctx.dir, 'deck.json'), 'utf8'));
    } catch {
      return { title: path.basename(ctx.dir) };
    }
  };

  const listSlides = async (ctx) => {
    try {
      return (await fsp.readdir(ctx.slidesDir)).filter((f) => f.endsWith('.html')).sort();
    } catch {
      return [];
    }
  };

  const safeSlidePath = (ctx, file) => {
    const p = path.resolve(ctx.slidesDir, file);
    if (!p.startsWith(ctx.slidesDir + path.sep) || !p.endsWith('.html')) return null;
    return p;
  };

  const writeOwn = async (absPath, content) => {
    ownWrites.set(absPath, Date.now());
    await fsp.writeFile(absPath, content);
  };

  const readComments = async (ctx) => {
    try {
      return JSON.parse(await fsp.readFile(path.join(ctx.dir, 'comments.json'), 'utf8'));
    } catch {
      return { nextId: 1, comments: [] };
    }
  };
  const writeComments = (ctx, data) =>
    writeOwn(path.join(ctx.dir, 'comments.json'), JSON.stringify(data, null, 2) + '\n');

  const nextSlideName = async (ctx, slug = 'slide') => {
    const nums = (await listSlides(ctx)).map((f) => parseInt(f) || 0);
    const n = (nums.length ? Math.max(...nums) : 0) + 1;
    return String(n).padStart(2, '0') + '-' + slug + '.html';
  };

  const themeInlined = async (ctx, html) => {
    let theme = '';
    try {
      theme = await fsp.readFile(path.join(ctx.dir, 'theme.css'), 'utf8');
    } catch {}
    return html.replace(/<link[^>]*href=["'][^"']*theme\.css["'][^>]*>/i, () => `<style>\n${theme}\n</style>`);
  };

  const json = (res, code, obj) => {
    res.writeHead(code, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(obj));
  };
  const page = (res, html) => {
    res.writeHead(200, { 'Content-Type': MIME['.html'] });
    res.end(html);
  };

  const readBody = (req) =>
    new Promise((resolve, reject) => {
      let data = '';
      req.on('data', (c) => {
        data += c;
        if (data.length > 25e6) reject(new Error('body too large'));
      });
      req.on('end', () => resolve(data));
      req.on('error', reject);
    });

  const sendFile = async (res, absPath) => {
    try {
      const buf = await fsp.readFile(absPath);
      res.writeHead(200, {
        'Content-Type': MIME[path.extname(absPath).toLowerCase()] || 'application/octet-stream',
        'Cache-Control': 'no-store',
      });
      res.end(buf);
      return true;
    } catch {
      return false;
    }
  };

  const broadcast = (event) => {
    const msg = `data: ${JSON.stringify(event)}\n\n`;
    for (const res of sseClients) res.write(msg);
  };

  // ---------- watcher ----------

  const debounce = new Map();
  try {
    fs.watch(rootDir, { recursive: true }, (_type, filename) => {
      if (!filename) return;
      const rel = filename.replaceAll(path.sep, '/');
      if (rel.split('/').some((seg) => seg.startsWith('.'))) return;
      if (rel.endsWith('comments.json')) return;
      const abs = path.join(rootDir, filename);
      const own = ownWrites.get(abs);
      if (own && Date.now() - own < 1500) return;
      clearTimeout(debounce.get(abs));
      debounce.set(
        abs,
        setTimeout(() => {
          debounce.delete(abs);
          broadcast({ type: 'change', file: rel });
        }, 120)
      );
    });
  } catch (e) {
    console.warn('pml: file watching unavailable:', e.message);
  }

  // ---------- shared page chrome ----------

  const sse = (prefix) => `
  new EventSource('/events').onmessage = (e) => {
    const ev = JSON.parse(e.data);
    if (ev.type === 'change' && ev.file.startsWith(${JSON.stringify(prefix)})) location.reload();
  };`;

  // ---------- hub page ----------

  const hubPage = async () => {
    const decks = listDecks();
    const cards = [];
    for (const name of decks) {
      const ctx = ctxFor(name);
      const meta = await deckMeta(ctx);
      const slides = await listSlides(ctx);
      const first = slides[0];
      cards.push(`
      <div class="card deck-card">
        <a class="thumb-link" href="${ctx.base}/" aria-label="Open deck ${esc(meta.title || name)}">
          <div class="thumb">${first ? `<iframe src="${ctx.base}/slides/${encodeURIComponent(first)}" loading="lazy" tabindex="-1" scrolling="no"></iframe>` : '<div class="thumb-empty">empty</div>'}</div>
        </a>
        <div class="card-meta">
          <span class="name big">${esc(meta.title || name)}</span>
          <span class="hint">${slides.length} slide${slides.length === 1 ? '' : 's'}</span>
          <span class="card-actions always">
            <a class="icon-btn" href="${ctx.base}/present" title="Present" aria-label="Present deck">▶</a>
            <a class="icon-btn" href="${ctx.base}/export?download=1" title="Export single file" aria-label="Export deck">⇩</a>
          </span>
        </div>
      </div>`);
    }
    return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>pml — decks</title>
${FAVICON}
<link rel="stylesheet" href="/_pml/app.css">
</head><body class="pml-app">
<header class="topbar">
  <div class="brand"><span class="logo">pml</span><h1>Your decks</h1></div>
  <nav><span class="hint">${cards.length} deck${cards.length === 1 ? '' : 's'} · click one to open</span></nav>
</header>
<main class="grid">${cards.join('')}
  <button class="card new-card" id="new-deck" aria-label="Create new deck"><span>＋</span>New deck</button>
</main>
<div class="pml-modal" id="modal" hidden>
  <div class="pml-modal-box">
    <h2>New deck</h2>
    <input id="deck-name" placeholder="Deck name (e.g. Q3 Review)" autocomplete="off">
    <div class="row"><button class="btn" id="modal-cancel">Cancel</button><button class="btn primary" id="modal-create">Create</button></div>
  </div>
</div>
<script>
  function fitThumbs() {
    document.querySelectorAll('.thumb').forEach((t) => {
      const f = t.querySelector('iframe');
      if (f) f.style.transform = 'scale(' + t.clientWidth / 1280 + ')';
    });
  }
  addEventListener('resize', fitThumbs);
  fitThumbs();
  const modal = document.getElementById('modal');
  const nameIn = document.getElementById('deck-name');
  document.getElementById('new-deck').addEventListener('click', () => { modal.hidden = false; nameIn.focus(); });
  document.getElementById('modal-cancel').addEventListener('click', () => (modal.hidden = true));
  async function createDeck() {
    const name = nameIn.value.trim();
    if (!name) return;
    const r = await fetch('/api/decks', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name }) });
    const out = await r.json();
    if (out.ok) location.href = '/d/' + encodeURIComponent(out.deck) + '/';
  }
  document.getElementById('modal-create').addEventListener('click', createDeck);
  nameIn.addEventListener('keydown', (e) => { if (e.key === 'Enter') createDeck(); if (e.key === 'Escape') modal.hidden = true; });
  ${sse('')}
</script>
</body></html>`;
  };

  // ---------- deck pages ----------

  const overviewPage = async (ctx) => {
    const meta = await deckMeta(ctx);
    const slides = await listSlides(ctx);
    const b = ctx.base;
    const cards = slides
      .map(
        (f, i) => `
      <div class="card" data-file="${esc(f)}">
        <a class="thumb-link" href="${b}/edit/${encodeURIComponent(f)}" aria-label="Edit slide ${i + 1}">
          <div class="thumb"><iframe src="${b}/slides/${encodeURIComponent(f)}" loading="lazy" tabindex="-1" scrolling="no"></iframe></div>
        </a>
        <div class="card-meta">
          <span class="num">${String(i + 1).padStart(2, '0')}</span>
          <span class="name rename" title="Click to rename" role="button" tabindex="0">${esc(f.replace(/^\d+-/, '').replace(/\.html$/, ''))}</span>
          <span class="card-actions">
            <button class="icon-btn" data-act="duplicate" title="Duplicate slide" aria-label="Duplicate slide">⧉</button>
            <button class="icon-btn danger" data-act="delete" title="Delete slide (moves to .trash)" aria-label="Delete slide">✕</button>
          </span>
        </div>
      </div>`
      )
      .join('');
    return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(meta.title || 'pml deck')}</title>
${FAVICON}
<link rel="stylesheet" href="/_pml/app.css">
</head><body class="pml-app">
<header class="topbar">
  <div class="brand">
    ${hubMode ? `<a class="back" href="/" title="All decks" aria-label="All decks">‹</a>` : ''}
    <span class="logo">pml</span>
    <h1 id="deck-title" contenteditable="true" spellcheck="false" title="Click to edit deck title">${esc(meta.title || 'Untitled deck')}</h1>
  </div>
  <nav>
    <span class="hint">${slides.length} slide${slides.length === 1 ? '' : 's'} · click a slide to edit · click its name to rename</span>
    <a class="btn" href="${b}/export?download=1" title="Download the whole deck as one self-contained HTML file">⇩ Export</a>
    <a class="btn primary" href="${b}/present">▶ Present</a>
  </nav>
</header>
<main class="grid">${cards || '<p class="empty">No slides yet — click <b>＋ New slide</b>.</p>'}
  <button class="card new-card" id="new-slide" aria-label="Add new slide"><span>＋</span>New slide</button>
</main>
<script>
  const BASE = ${jsonForScript(b)};
  function fitThumbs() {
    document.querySelectorAll('.thumb').forEach((t) => {
      const f = t.querySelector('iframe');
      if (f) f.style.transform = 'scale(' + t.clientWidth / 1280 + ')';
    });
  }
  addEventListener('resize', fitThumbs);
  fitThumbs();
  const slideAction = (body) =>
    fetch(BASE + '/api/slide', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  document.getElementById('new-slide').addEventListener('click', () => slideAction({ action: 'new' }));
  document.querySelectorAll('.icon-btn[data-act]').forEach((btn) =>
    btn.addEventListener('click', (e) => {
      e.preventDefault();
      const file = btn.closest('.card').dataset.file;
      if (btn.dataset.act === 'delete' && !btn.classList.contains('confirm')) {
        btn.classList.add('confirm');
        btn.textContent = 'sure?';
        setTimeout(() => { btn.classList.remove('confirm'); btn.textContent = '✕'; }, 2500);
        return;
      }
      slideAction({ action: btn.dataset.act, file });
    })
  );
  // slide rename: click name → inline input
  document.querySelectorAll('.name.rename').forEach((span) => {
    const start = () => {
      const card = span.closest('.card');
      const input = document.createElement('input');
      input.value = span.textContent;
      input.className = 'rename-input';
      span.replaceWith(input);
      input.focus();
      input.select();
      const done = async (commit) => {
        if (commit && input.value.trim() && input.value.trim() !== span.textContent) {
          await slideAction({ action: 'rename', file: card.dataset.file, name: input.value.trim() });
        } else input.replaceWith(span);
      };
      input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') done(true);
        if (e.key === 'Escape') done(false);
      });
      input.addEventListener('blur', () => done(true));
    };
    span.addEventListener('click', start);
    span.addEventListener('keydown', (e) => { if (e.key === 'Enter') start(); });
  });
  // deck title: contenteditable → save on blur/Enter
  const titleEl = document.getElementById('deck-title');
  titleEl.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); titleEl.blur(); } });
  titleEl.addEventListener('blur', () => {
    fetch(BASE + '/api/deck', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ title: titleEl.textContent.trim() }) });
    document.title = titleEl.textContent.trim();
  });
  ${sse(ctx.evPrefix)}
</script>
</body></html>`;
  };

  const presentPage = async (ctx) => {
    const meta = await deckMeta(ctx);
    const slides = await listSlides(ctx);
    const b = ctx.base;
    return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(meta.title || 'pml')} — present</title>
${FAVICON}
<link rel="stylesheet" href="/_pml/app.css">
</head><body class="pml-present">
<div id="stage"><div id="frame-holder"></div></div>
<div id="hud"><span id="counter"></span><span class="hud-hint">← → navigate · F fullscreen · Esc overview</span></div>
<script>
  const BASE = ${jsonForScript(b)};
  const slides = ${jsonForScript(slides)};
  const transition = ${jsonForScript(meta.transition || 'slide')};
  let idx = Math.max(0, slides.indexOf(new URLSearchParams(location.search).get('slide')));
  const holder = document.getElementById('frame-holder');
  const counter = document.getElementById('counter');
  function fit() {
    const s = Math.min(innerWidth / 1280, innerHeight / 720);
    holder.style.transform = 'translate(-50%,-50%) scale(' + s + ')';
  }
  function show(dir = 0) {
    const old = holder.querySelector('iframe');
    const f = document.createElement('iframe');
    f.setAttribute('scrolling', 'no');
    f.src = BASE + '/slides/' + encodeURIComponent(slides[idx]);
    if (transition !== 'none' && old) {
      f.style.opacity = '0';
      if (transition === 'slide') f.style.transform = 'translateX(' + dir * 60 + 'px)';
      holder.appendChild(f);
      f.addEventListener('load', () => {
        f.style.opacity = '1';
        f.style.transform = 'translateX(0)';
        old.style.opacity = '0';
        if (transition === 'slide') old.style.transform = 'translateX(' + dir * -60 + 'px)';
        setTimeout(() => old.remove(), 420);
      }, { once: true });
    } else {
      if (old) old.remove();
      holder.appendChild(f);
    }
    counter.textContent = (idx + 1) + ' / ' + slides.length;
    history.replaceState(null, '', BASE + '/present?slide=' + encodeURIComponent(slides[idx]));
  }
  function nav(d) {
    if (d > 0 && idx < slides.length - 1) { idx++; show(1); }
    else if (d < 0 && idx > 0) { idx--; show(-1); }
  }
  addEventListener('keydown', (e) => {
    if (e.key === 'ArrowRight' || e.key === ' ' || e.key === 'PageDown') nav(1);
    else if (e.key === 'ArrowLeft' || e.key === 'PageUp') nav(-1);
    else if (e.key === 'f' || e.key === 'F') document.documentElement.requestFullscreen?.();
    else if (e.key === 'Escape') location.href = BASE + '/';
  });
  let tx = null;
  addEventListener('touchstart', (e) => (tx = e.touches[0].clientX), { passive: true });
  addEventListener('touchend', (e) => {
    if (tx === null) return;
    const dx = e.changedTouches[0].clientX - tx;
    tx = null;
    if (Math.abs(dx) > 50) nav(dx < 0 ? 1 : -1);
  }, { passive: true });
  addEventListener('resize', fit);
  fit(); show();
  new EventSource('/events').onmessage = (e) => {
    const ev = JSON.parse(e.data);
    if (ev.type === 'change' && ev.file.endsWith(slides[idx])) show();
  };
</script>
</body></html>`;
  };

  const exportPage = async (ctx) => {
    const meta = await deckMeta(ctx);
    const files = await listSlides(ctx);
    const slides = [];
    for (const f of files) {
      slides.push(await themeInlined(ctx, await fsp.readFile(path.join(ctx.slidesDir, f), 'utf8')));
    }
    return `<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<title>${esc(meta.title || 'deck')}</title>
${FAVICON}
<style>
  html,body{margin:0;height:100%;background:#000;overflow:hidden;font-family:system-ui,sans-serif}
  #holder{position:absolute;top:50%;left:50%;width:1280px;height:720px;transform-origin:center}
  iframe{width:1280px;height:720px;border:0;position:absolute;inset:0;transition:opacity .35s ease;background:#000}
  #hud{position:fixed;bottom:16px;left:50%;transform:translateX(-50%);color:#eee;background:rgba(20,20,30,.85);
       border:1px solid #333;border-radius:999px;padding:7px 16px;font-size:13px;opacity:0;transition:opacity .25s}
  body:hover #hud{opacity:1}
</style></head><body>
<div id="holder"></div>
<div id="hud"><span id="c"></span> · ← → navigate · F fullscreen</div>
<script>
  const slides = ${jsonForScript(slides)};
  let idx = 0;
  const holder = document.getElementById('holder');
  function fit(){ const s=Math.min(innerWidth/1280,innerHeight/720); holder.style.transform='translate(-50%,-50%) scale('+s+')'; }
  function show(){
    const old = holder.querySelector('iframe');
    const f = document.createElement('iframe');
    f.style.opacity = '0';
    f.srcdoc = slides[idx];
    holder.appendChild(f);
    requestAnimationFrame(()=>requestAnimationFrame(()=>{ f.style.opacity='1'; if(old){ old.style.opacity='0'; setTimeout(()=>old.remove(),380); } }));
    document.getElementById('c').textContent = (idx+1)+' / '+slides.length;
  }
  function nav(d){ if(d>0&&idx<slides.length-1){idx++;show();} else if(d<0&&idx>0){idx--;show();} }
  addEventListener('keydown',(e)=>{
    if(e.key==='ArrowRight'||e.key===' ')nav(1);
    else if(e.key==='ArrowLeft')nav(-1);
    else if(e.key==='f'||e.key==='F')document.documentElement.requestFullscreen?.();
  });
  let tx=null;
  addEventListener('touchstart',(e)=>tx=e.touches[0].clientX,{passive:true});
  addEventListener('touchend',(e)=>{ if(tx===null)return; const dx=e.changedTouches[0].clientX-tx; tx=null; if(Math.abs(dx)>50)nav(dx<0?1:-1); },{passive:true});
  addEventListener('resize',fit); fit(); show();
</script>
</body></html>`;
  };

  const editPage = async (ctx, file) => {
    const abs = safeSlidePath(ctx, file);
    if (!abs || !fs.existsSync(abs)) return null;
    let html = await fsp.readFile(abs, 'utf8');
    const slides = await listSlides(ctx);
    const inject = `
<link rel="stylesheet" href="/_pml/editor.css" data-pml-runtime>
<script data-pml-runtime>window.__PML__ = ${jsonForScript({
      file,
      slides,
      index: slides.indexOf(file),
      base: ctx.base,
      evPrefix: ctx.evPrefix,
    })};</script>
<script src="/_pml/editor.js" defer data-pml-runtime></script>
`;
    if (/<\/body>/i.test(html)) html = html.replace(/<\/body>/i, inject + '</body>');
    else html += inject;
    return html;
  };

  // ---------- per-deck request handling ----------

  const handleDeck = async (ctx, sub, req, res, url) => {
    // API
    if (sub === '/api/save' && req.method === 'POST') {
      const { file, html } = JSON.parse(await readBody(req));
      const abs = safeSlidePath(ctx, file);
      if (!abs) return json(res, 400, { error: 'bad file path' });
      await writeOwn(abs, html);
      broadcast({ type: 'saved', file: ctx.evPrefix + 'slides/' + file });
      return json(res, 200, { ok: true });
    }
    if (sub === '/api/slides' && req.method === 'GET') {
      return json(res, 200, { slides: await listSlides(ctx) });
    }
    if (sub === '/api/deck' && req.method === 'POST') {
      const body = JSON.parse(await readBody(req));
      const meta = await deckMeta(ctx);
      if (typeof body.title === 'string' && body.title.trim()) meta.title = body.title.trim().slice(0, 120);
      if (['slide', 'fade', 'none'].includes(body.transition)) meta.transition = body.transition;
      await writeOwn(path.join(ctx.dir, 'deck.json'), JSON.stringify(meta, null, 2) + '\n');
      return json(res, 200, { ok: true, meta });
    }
    if (sub === '/api/slide' && req.method === 'POST') {
      const { action, file, name } = JSON.parse(await readBody(req));
      if (action === 'new') {
        const fname = await nextSlideName(ctx);
        await writeOwn(path.join(ctx.slidesDir, fname), BLANK_SLIDE);
        broadcast({ type: 'change', file: ctx.evPrefix + 'slides/' + fname });
        return json(res, 200, { ok: true, file: fname });
      }
      const abs = safeSlidePath(ctx, file || '');
      if (!abs || !fs.existsSync(abs)) return json(res, 400, { error: 'bad file' });
      if (action === 'duplicate') {
        const slug = (file.replace(/^\d+-/, '').replace(/\.html$/, '') || 'slide') + '-copy';
        const fname = await nextSlideName(ctx, slug);
        await writeOwn(path.join(ctx.slidesDir, fname), await fsp.readFile(abs, 'utf8'));
        broadcast({ type: 'change', file: ctx.evPrefix + 'slides/' + fname });
        return json(res, 200, { ok: true, file: fname });
      }
      if (action === 'rename') {
        const prefix = (file.match(/^(\d+)-/) || [, '01'])[1];
        const fname = prefix + '-' + slugify(name) + '.html';
        const dest = safeSlidePath(ctx, fname);
        if (!dest) return json(res, 400, { error: 'bad name' });
        if (fs.existsSync(dest) && dest !== abs) return json(res, 409, { error: 'name taken' });
        ownWrites.set(dest, Date.now());
        ownWrites.set(abs, Date.now());
        await fsp.rename(abs, dest);
        broadcast({ type: 'change', file: ctx.evPrefix + 'slides/' + fname });
        return json(res, 200, { ok: true, file: fname });
      }
      if (action === 'delete') {
        // Soft delete: move into .trash/ so nothing is ever lost.
        const trash = path.join(ctx.dir, '.trash');
        await fsp.mkdir(trash, { recursive: true });
        await fsp.rename(abs, path.join(trash, Date.now() + '-' + file));
        broadcast({ type: 'change', file: ctx.evPrefix + 'slides/' + file });
        return json(res, 200, { ok: true });
      }
      return json(res, 400, { error: 'unknown action' });
    }
    if (sub === '/api/upload' && req.method === 'POST') {
      const { name, data } = JSON.parse(await readBody(req));
      const m = /^data:(image\/[a-z+]+);base64,(.+)$/s.exec(String(data || ''));
      if (!m) return json(res, 400, { error: 'expected image data URL' });
      const safe = String(name || 'image').replace(/[^a-zA-Z0-9._-]/g, '_').slice(-80);
      const assets = path.join(ctx.dir, 'assets');
      await fsp.mkdir(assets, { recursive: true });
      const fname = Date.now() + '-' + safe;
      const abs = path.join(assets, fname);
      ownWrites.set(abs, Date.now());
      await fsp.writeFile(abs, Buffer.from(m[2], 'base64'));
      return json(res, 200, { ok: true, path: 'assets/' + fname });
    }
    if (sub === '/api/comments' && req.method === 'GET') {
      const data = await readComments(ctx);
      const file = url.searchParams.get('file');
      return json(res, 200, { comments: file ? data.comments.filter((c) => c.file === file) : data.comments });
    }
    if (sub === '/api/comments' && req.method === 'POST') {
      const body = JSON.parse(await readBody(req));
      const data = await readComments(ctx);
      const comment = {
        id: data.nextId++,
        file: String(body.file || ''),
        x: Number(body.x) || 0,
        y: Number(body.y) || 0,
        author: String(body.author || 'anon').slice(0, 60),
        text: String(body.text || '').slice(0, 4000),
        resolved: false,
        ts: Date.now(),
        replies: [],
      };
      data.comments.push(comment);
      await writeComments(ctx, data);
      return json(res, 200, { ok: true, comment });
    }
    const commentAction = sub.match(/^\/api\/comments\/(\d+)\/(resolve|reply)$/);
    if (commentAction && req.method === 'POST') {
      const data = await readComments(ctx);
      const c = data.comments.find((c) => c.id === Number(commentAction[1]));
      if (!c) return json(res, 404, { error: 'not found' });
      if (commentAction[2] === 'resolve') c.resolved = !c.resolved;
      else {
        const body = JSON.parse(await readBody(req));
        c.replies.push({
          author: String(body.author || 'anon').slice(0, 60),
          text: String(body.text || '').slice(0, 4000),
          ts: Date.now(),
        });
      }
      await writeComments(ctx, data);
      return json(res, 200, { ok: true, comment: c });
    }

    // Pages
    if (sub === '/' || sub === '') return page(res, await overviewPage(ctx));
    if (sub === '/present') return page(res, await presentPage(ctx));
    if (sub === '/export') {
      const meta = await deckMeta(ctx);
      const html = await exportPage(ctx);
      res.writeHead(200, {
        'Content-Type': MIME['.html'],
        ...(url.searchParams.has('download') && {
          'Content-Disposition': `attachment; filename="${(meta.title || 'deck').replace(/[^\w -]/g, '')}.html"`,
        }),
      });
      return res.end(html);
    }
    if (sub.startsWith('/export/')) {
      const file = sub.slice('/export/'.length);
      const abs = safeSlidePath(ctx, file);
      if (!abs || !fs.existsSync(abs)) return json(res, 404, { error: 'slide not found' });
      const html = await themeInlined(ctx, await fsp.readFile(abs, 'utf8'));
      res.writeHead(200, {
        'Content-Type': MIME['.html'],
        'Content-Disposition': `attachment; filename="${file}"`,
      });
      return res.end(html);
    }
    if (sub.startsWith('/edit/')) {
      const html = await editPage(ctx, sub.slice('/edit/'.length));
      if (html === null) return json(res, 404, { error: 'slide not found' });
      return page(res, html);
    }

    // Deck static files (slides/, theme.css, assets/…)
    const abs = path.resolve(ctx.dir, sub.slice(1));
    if (abs.startsWith(ctx.dir) && (await sendFile(res, abs))) return;
    return json(res, 404, { error: 'not found' });
  };

  // ---------- server ----------

  const server = http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url, 'http://localhost');
      const p = decodeURIComponent(url.pathname);

      // SSE (global)
      if (p === '/events') {
        res.writeHead(200, {
          'Content-Type': 'text/event-stream',
          'Cache-Control': 'no-store',
          Connection: 'keep-alive',
        });
        res.write('retry: 500\n\n');
        sseClients.add(res);
        const hb = setInterval(() => res.write(': hb\n\n'), 25000);
        req.on('close', () => {
          clearInterval(hb);
          sseClients.delete(res);
        });
        return;
      }

      // Editor runtime assets (global)
      if (p.startsWith('/_pml/')) {
        const abs = path.resolve(EDITOR_DIR, p.slice('/_pml/'.length));
        if (abs.startsWith(EDITOR_DIR) && (await sendFile(res, abs))) return;
        return json(res, 404, { error: 'not found' });
      }

      if (hubMode) {
        if (p === '/' || p === '') return page(res, await hubPage());
        if (p === '/api/decks' && req.method === 'POST') {
          const { name } = JSON.parse(await readBody(req));
          const slug = slugify(name);
          const dest = path.join(rootDir, slug);
          if (fs.existsSync(dest)) return json(res, 409, { error: 'deck exists' });
          fs.cpSync(TEMPLATE_DIR, dest, { recursive: true });
          const metaPath = path.join(dest, 'deck.json');
          const meta = JSON.parse(fs.readFileSync(metaPath, 'utf8'));
          meta.title = String(name).trim().slice(0, 120) || slug;
          ownWrites.set(metaPath, Date.now());
          fs.writeFileSync(metaPath, JSON.stringify(meta, null, 2) + '\n');
          broadcast({ type: 'change', file: slug + '/deck.json' });
          return json(res, 200, { ok: true, deck: slug });
        }
        const m = p.match(/^\/d\/([^/]+)(\/.*)?$/);
        if (m) {
          const ctx = ctxFor(m[1]);
          if (!ctx) return json(res, 404, { error: 'deck not found' });
          return handleDeck(ctx, m[2] || '/', req, res, url);
        }
        return json(res, 404, { error: 'not found' });
      }

      // single-deck mode
      return handleDeck(ctxFor(''), p, req, res, url);
    } catch (e) {
      json(res, 500, { error: e.message });
    }
  });

  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, resolve);
  });
  return { server, port, deckDir: rootDir, hubMode };
}
