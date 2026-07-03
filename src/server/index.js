// lmth server — zero-dependency presentation server.
// Serves a deck folder, injects the visual editor, streams live-reload
// events over SSE, and persists saves/comments back to disk.

import http from 'node:http';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const EDITOR_DIR = path.resolve(__dirname, '../editor');

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
  `<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 64 64'><defs><linearGradient id='g' x1='0' y1='0' x2='1' y2='1'><stop offset='0' stop-color='%237c6cff'/><stop offset='1' stop-color='%23ff6ec7'/></linearGradient></defs><rect width='64' height='64' rx='14' fill='url(%23g)'/><text x='32' y='44' font-family='monospace' font-size='34' font-weight='700' text-anchor='middle' fill='%230a0a0f'>l</text></svg>`
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

export async function startServer({ deckDir, port = 4321 }) {
  deckDir = path.resolve(deckDir);
  const slidesDir = path.join(deckDir, 'slides');
  if (!fs.existsSync(slidesDir)) {
    throw new Error(`Not a lmth deck: ${deckDir} (missing slides/ folder). Run \`lmth new <name>\` to create one.`);
  }

  const sseClients = new Set();
  const ownWrites = new Map(); // abs path -> timestamp of our own write

  // ---------- helpers ----------

  const deckMeta = async () => {
    try {
      return JSON.parse(await fsp.readFile(path.join(deckDir, 'deck.json'), 'utf8'));
    } catch {
      return { title: path.basename(deckDir) };
    }
  };

  const listSlides = async () =>
    (await fsp.readdir(slidesDir))
      .filter((f) => f.endsWith('.html'))
      .sort();

  const safeSlidePath = (file) => {
    const p = path.resolve(slidesDir, file);
    if (!p.startsWith(slidesDir + path.sep) || !p.endsWith('.html')) return null;
    return p;
  };

  const writeOwn = async (absPath, content) => {
    ownWrites.set(absPath, Date.now());
    await fsp.writeFile(absPath, content);
  };

  const nextSlideName = async (slug = 'slide') => {
    const nums = (await listSlides()).map((f) => parseInt(f) || 0);
    const n = (nums.length ? Math.max(...nums) : 0) + 1;
    return String(n).padStart(2, '0') + '-' + slug + '.html';
  };

  const themeInlined = async (html) => {
    let theme = '';
    try {
      theme = await fsp.readFile(path.join(deckDir, 'theme.css'), 'utf8');
    } catch {}
    return html.replace(/<link[^>]*href=["'][^"']*theme\.css["'][^>]*>/i, () => `<style>\n${theme}\n</style>`);
  };

  const commentsPath = path.join(deckDir, 'comments.json');
  const readComments = async () => {
    try {
      return JSON.parse(await fsp.readFile(commentsPath, 'utf8'));
    } catch {
      return { nextId: 1, comments: [] };
    }
  };
  const writeComments = (data) => writeOwn(commentsPath, JSON.stringify(data, null, 2) + '\n');

  const json = (res, code, obj) => {
    res.writeHead(code, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(obj));
  };

  const readBody = (req) =>
    new Promise((resolve, reject) => {
      let data = '';
      req.on('data', (c) => {
        data += c;
        if (data.length > 10e6) reject(new Error('body too large'));
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
    fs.watch(deckDir, { recursive: true }, (_type, filename) => {
      if (!filename) return;
      const abs = path.join(deckDir, filename);
      if (path.basename(filename) === 'comments.json') return;
      if (filename.startsWith('.')) return;
      const own = ownWrites.get(abs);
      if (own && Date.now() - own < 1500) return;
      clearTimeout(debounce.get(abs));
      debounce.set(
        abs,
        setTimeout(() => {
          debounce.delete(abs);
          broadcast({ type: 'change', file: filename.replaceAll(path.sep, '/') });
        }, 120)
      );
    });
  } catch (e) {
    console.warn('lmth: file watching unavailable:', e.message);
  }

  // ---------- pages ----------

  const overviewPage = async () => {
    const meta = await deckMeta();
    const slides = await listSlides();
    const cards = slides
      .map(
        (f, i) => `
      <div class="card" data-file="${esc(f)}">
        <a class="thumb-link" href="/edit/${encodeURIComponent(f)}">
          <div class="thumb"><iframe src="/slides/${encodeURIComponent(f)}" loading="lazy" tabindex="-1" scrolling="no"></iframe></div>
        </a>
        <div class="card-meta">
          <span class="num">${String(i + 1).padStart(2, '0')}</span><span class="name">${esc(f.replace(/\.html$/, ''))}</span>
          <span class="card-actions">
            <button class="icon-btn" data-act="duplicate" title="Duplicate slide">⧉</button>
            <button class="icon-btn danger" data-act="delete" title="Delete slide (moves to .trash)">✕</button>
          </span>
        </div>
      </div>`
      )
      .join('');
    return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(meta.title || 'lmth deck')}</title>
${FAVICON}
<link rel="stylesheet" href="/_lmth/app.css">
</head><body class="lmth-app">
<header class="topbar">
  <div class="brand"><span class="logo">lmth</span><h1>${esc(meta.title || 'Untitled deck')}</h1></div>
  <nav>
    <span class="hint">${slides.length} slide${slides.length === 1 ? '' : 's'} · click any slide to edit</span>
    <a class="btn" href="/export?download=1" title="Download the whole deck as one self-contained HTML file">⇩ Export</a>
    <a class="btn primary" href="/present">▶ Present</a>
  </nav>
</header>
<main class="grid">${cards || '<p class="empty">No slides yet. Click <b>＋ New slide</b> or add HTML files to <code>slides/</code>.</p>'}
  <button class="card new-card" id="new-slide"><span>＋</span>New slide</button>
</main>
<script>
  function fitThumbs() {
    document.querySelectorAll('.thumb').forEach((t) => {
      const s = t.clientWidth / 1280;
      t.querySelector('iframe').style.transform = 'scale(' + s + ')';
    });
  }
  addEventListener('resize', fitThumbs);
  fitThumbs();
  const slideAction = (action, file) =>
    fetch('/api/slide', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action, file }) });
  document.getElementById('new-slide').addEventListener('click', () => slideAction('new'));
  document.querySelectorAll('.icon-btn').forEach((b) =>
    b.addEventListener('click', (e) => {
      e.preventDefault();
      const file = b.closest('.card').dataset.file;
      if (b.dataset.act === 'delete' && !b.classList.contains('confirm')) {
        b.classList.add('confirm');
        b.textContent = 'sure?';
        setTimeout(() => { b.classList.remove('confirm'); b.textContent = '✕'; }, 2500);
        return;
      }
      slideAction(b.dataset.act, file);
    })
  );
  new EventSource('/events').onmessage = (e) => {
    const ev = JSON.parse(e.data);
    if (ev.type === 'change') location.reload();
  };
</script>
</body></html>`;
  };

  const exportPage = async () => {
    const meta = await deckMeta();
    const files = await listSlides();
    const slides = [];
    for (const f of files) {
      slides.push(await themeInlined(await fsp.readFile(path.join(slidesDir, f), 'utf8')));
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
  addEventListener('keydown',(e)=>{
    if((e.key==='ArrowRight'||e.key===' ')&&idx<slides.length-1){idx++;show();}
    else if(e.key==='ArrowLeft'&&idx>0){idx--;show();}
    else if(e.key==='f'||e.key==='F')document.documentElement.requestFullscreen?.();
  });
  addEventListener('resize',fit); fit(); show();
</script>
</body></html>`;
  };

  const presentPage = async () => {
    const meta = await deckMeta();
    const slides = await listSlides();
    return `<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<title>${esc(meta.title || 'lmth')} — present</title>
${FAVICON}
<link rel="stylesheet" href="/_lmth/app.css">
</head><body class="lmth-present">
<div id="stage"><div id="frame-holder"></div></div>
<div id="hud"><span id="counter"></span><span class="hud-hint">← → navigate · F fullscreen · Esc overview</span></div>
<script>
  const slides = ${jsonForScript(slides)};
  const transition = ${jsonForScript(meta.transition || 'slide')}; // "slide" | "fade" | "none"
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
    f.src = '/slides/' + encodeURIComponent(slides[idx]);
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
    history.replaceState(null, '', '/present?slide=' + encodeURIComponent(slides[idx]));
  }
  addEventListener('keydown', (e) => {
    if (e.key === 'ArrowRight' || e.key === ' ' || e.key === 'PageDown') { if (idx < slides.length - 1) { idx++; show(1); } }
    else if (e.key === 'ArrowLeft' || e.key === 'PageUp') { if (idx > 0) { idx--; show(-1); } }
    else if (e.key === 'f' || e.key === 'F') document.documentElement.requestFullscreen?.();
    else if (e.key === 'Escape') location.href = '/';
  });
  addEventListener('resize', fit);
  fit(); show();
  new EventSource('/events').onmessage = (e) => {
    const ev = JSON.parse(e.data);
    if (ev.type === 'change' && ev.file.endsWith(slides[idx])) show();
  };
</script>
</body></html>`;
  };

  const editPage = async (file) => {
    const abs = safeSlidePath(file);
    if (!abs || !fs.existsSync(abs)) return null;
    let html = await fsp.readFile(abs, 'utf8');
    const slides = await listSlides();
    const inject = `
<link rel="stylesheet" href="/_lmth/editor.css" data-lmth-runtime>
<script data-lmth-runtime>window.__LMTH__ = ${JSON.stringify({ file, slides, index: slides.indexOf(file) })};</script>
<script src="/_lmth/editor.js" defer data-lmth-runtime></script>
`;
    if (/<\/body>/i.test(html)) html = html.replace(/<\/body>/i, inject + '</body>');
    else html += inject;
    return html;
  };

  // ---------- server ----------

  const server = http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url, 'http://localhost');
      const p = decodeURIComponent(url.pathname);

      // SSE
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

      // API
      if (p === '/api/save' && req.method === 'POST') {
        const { file, html } = JSON.parse(await readBody(req));
        const abs = safeSlidePath(file);
        if (!abs) return json(res, 400, { error: 'bad file path' });
        await writeOwn(abs, html);
        broadcast({ type: 'saved', file: `slides/${file}` });
        return json(res, 200, { ok: true });
      }
      if (p === '/api/slides' && req.method === 'GET') {
        return json(res, 200, { slides: await listSlides() });
      }
      if (p === '/api/slide' && req.method === 'POST') {
        const { action, file } = JSON.parse(await readBody(req));
        if (action === 'new') {
          const name = await nextSlideName();
          await writeOwn(path.join(slidesDir, name), BLANK_SLIDE);
          broadcast({ type: 'change', file: 'slides/' + name });
          return json(res, 200, { ok: true, file: name });
        }
        const abs = safeSlidePath(file || '');
        if (!abs || !fs.existsSync(abs)) return json(res, 400, { error: 'bad file' });
        if (action === 'duplicate') {
          const slug = (file.replace(/^\d+-/, '').replace(/\.html$/, '') || 'slide') + '-copy';
          const name = await nextSlideName(slug);
          await writeOwn(path.join(slidesDir, name), await fsp.readFile(abs, 'utf8'));
          broadcast({ type: 'change', file: 'slides/' + name });
          return json(res, 200, { ok: true, file: name });
        }
        if (action === 'delete') {
          // Soft delete: move into .trash/ so nothing is ever lost.
          const trash = path.join(deckDir, '.trash');
          await fsp.mkdir(trash, { recursive: true });
          await fsp.rename(abs, path.join(trash, Date.now() + '-' + file));
          broadcast({ type: 'change', file: 'slides/' + file });
          return json(res, 200, { ok: true });
        }
        return json(res, 400, { error: 'unknown action' });
      }
      if (p === '/api/upload' && req.method === 'POST') {
        const { name, data } = JSON.parse(await readBody(req));
        const m = /^data:(image\/[a-z+]+);base64,(.+)$/s.exec(String(data || ''));
        if (!m) return json(res, 400, { error: 'expected image data URL' });
        const safe = String(name || 'image').replace(/[^a-zA-Z0-9._-]/g, '_').slice(-80);
        const assets = path.join(deckDir, 'assets');
        await fsp.mkdir(assets, { recursive: true });
        const fname = Date.now() + '-' + safe;
        ownWrites.set(path.join(assets, fname), Date.now());
        await fsp.writeFile(path.join(assets, fname), Buffer.from(m[2], 'base64'));
        return json(res, 200, { ok: true, path: 'assets/' + fname });
      }
      if (p === '/api/comments' && req.method === 'GET') {
        const data = await readComments();
        const file = url.searchParams.get('file');
        return json(res, 200, {
          comments: file ? data.comments.filter((c) => c.file === file) : data.comments,
        });
      }
      if (p === '/api/comments' && req.method === 'POST') {
        const body = JSON.parse(await readBody(req));
        const data = await readComments();
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
        await writeComments(data);
        return json(res, 200, { ok: true, comment });
      }
      const commentAction = p.match(/^\/api\/comments\/(\d+)\/(resolve|reply)$/);
      if (commentAction && req.method === 'POST') {
        const data = await readComments();
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
        await writeComments(data);
        return json(res, 200, { ok: true, comment: c });
      }

      // Pages
      if (p === '/') {
        res.writeHead(200, { 'Content-Type': MIME['.html'] });
        return res.end(await overviewPage());
      }
      if (p === '/present') {
        res.writeHead(200, { 'Content-Type': MIME['.html'] });
        return res.end(await presentPage());
      }
      if (p === '/export') {
        const meta = await deckMeta();
        const html = await exportPage();
        res.writeHead(200, {
          'Content-Type': MIME['.html'],
          ...(url.searchParams.has('download') && {
            'Content-Disposition': `attachment; filename="${(meta.title || 'deck').replace(/[^\w -]/g, '')}.html"`,
          }),
        });
        return res.end(html);
      }
      if (p.startsWith('/export/')) {
        const file = p.slice('/export/'.length);
        const abs = safeSlidePath(file);
        if (!abs || !fs.existsSync(abs)) return json(res, 404, { error: 'slide not found' });
        const html = await themeInlined(await fsp.readFile(abs, 'utf8'));
        res.writeHead(200, {
          'Content-Type': MIME['.html'],
          'Content-Disposition': `attachment; filename="${file}"`,
        });
        return res.end(html);
      }
      if (p.startsWith('/edit/')) {
        const html = await editPage(p.slice('/edit/'.length));
        if (html === null) return json(res, 404, { error: 'slide not found' });
        res.writeHead(200, { 'Content-Type': MIME['.html'] });
        return res.end(html);
      }

      // Editor runtime assets
      if (p.startsWith('/_lmth/')) {
        const abs = path.resolve(EDITOR_DIR, p.slice('/_lmth/'.length));
        if (abs.startsWith(EDITOR_DIR) && (await sendFile(res, abs))) return;
        return json(res, 404, { error: 'not found' });
      }

      // Deck static files (slides/, theme.css, assets/…)
      const abs = path.resolve(deckDir, p.slice(1));
      if (abs.startsWith(deckDir) && (await sendFile(res, abs))) return;

      return json(res, 404, { error: 'not found' });
    } catch (e) {
      json(res, 500, { error: e.message });
    }
  });

  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, resolve);
  });
  return { server, port, deckDir };
}
