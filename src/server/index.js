// pml server — zero-dependency presentation server.
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

export async function startServer({ deckDir, port = 4321 }) {
  deckDir = path.resolve(deckDir);
  const slidesDir = path.join(deckDir, 'slides');
  if (!fs.existsSync(slidesDir)) {
    throw new Error(`Not a pml deck: ${deckDir} (missing slides/ folder). Run \`pml new <name>\` to create one.`);
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
    console.warn('pml: file watching unavailable:', e.message);
  }

  // ---------- pages ----------

  const overviewPage = async () => {
    const meta = await deckMeta();
    const slides = await listSlides();
    const cards = slides
      .map(
        (f, i) => `
      <a class="card" href="/edit/${encodeURIComponent(f)}">
        <div class="thumb"><iframe src="/slides/${encodeURIComponent(f)}" loading="lazy" tabindex="-1" scrolling="no"></iframe></div>
        <div class="card-meta"><span class="num">${String(i + 1).padStart(2, '0')}</span><span class="name">${esc(f.replace(/\.html$/, ''))}</span></div>
      </a>`
      )
      .join('');
    return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(meta.title || 'pml deck')}</title>
<link rel="stylesheet" href="/_pml/app.css">
</head><body class="pml-app">
<header class="topbar">
  <div class="brand"><span class="logo">pml</span><h1>${esc(meta.title || 'Untitled deck')}</h1></div>
  <nav>
    <span class="hint">${slides.length} slide${slides.length === 1 ? '' : 's'} · click any slide to edit</span>
    <a class="btn primary" href="/present">▶ Present</a>
  </nav>
</header>
<main class="grid">${cards || '<p class="empty">No slides yet. Add HTML files to <code>slides/</code>.</p>'}</main>
<script>
  function fitThumbs() {
    document.querySelectorAll('.thumb').forEach((t) => {
      const s = t.clientWidth / 1280;
      t.querySelector('iframe').style.transform = 'scale(' + s + ')';
    });
  }
  addEventListener('resize', fitThumbs);
  fitThumbs();
  new EventSource('/events').onmessage = (e) => {
    const ev = JSON.parse(e.data);
    if (ev.type === 'change') location.reload();
  };
</script>
</body></html>`;
  };

  const presentPage = async () => {
    const meta = await deckMeta();
    const slides = await listSlides();
    return `<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<title>${esc(meta.title || 'pml')} — present</title>
<link rel="stylesheet" href="/_pml/app.css">
</head><body class="pml-present">
<div id="stage"><div id="frame-holder"></div></div>
<div id="hud"><span id="counter"></span><span class="hud-hint">← → navigate · F fullscreen · Esc overview</span></div>
<script>
  const slides = ${JSON.stringify(slides)};
  let idx = Math.max(0, slides.indexOf(new URLSearchParams(location.search).get('slide')));
  const holder = document.getElementById('frame-holder');
  const counter = document.getElementById('counter');
  function fit() {
    const s = Math.min(innerWidth / 1280, innerHeight / 720);
    holder.style.transform = 'translate(-50%,-50%) scale(' + s + ')';
  }
  function show() {
    holder.innerHTML = '<iframe src="/slides/' + encodeURIComponent(slides[idx]) + '" scrolling="no"></iframe>';
    counter.textContent = (idx + 1) + ' / ' + slides.length;
    history.replaceState(null, '', '/present?slide=' + encodeURIComponent(slides[idx]));
  }
  addEventListener('keydown', (e) => {
    if (e.key === 'ArrowRight' || e.key === ' ' || e.key === 'PageDown') { if (idx < slides.length - 1) { idx++; show(); } }
    else if (e.key === 'ArrowLeft' || e.key === 'PageUp') { if (idx > 0) { idx--; show(); } }
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
<link rel="stylesheet" href="/_pml/editor.css" data-pml-runtime>
<script data-pml-runtime>window.__PML__ = ${JSON.stringify({ file, slides, index: slides.indexOf(file) })};</script>
<script src="/_pml/editor.js" defer data-pml-runtime></script>
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
      if (p.startsWith('/edit/')) {
        const html = await editPage(p.slice('/edit/'.length));
        if (html === null) return json(res, 404, { error: 'slide not found' });
        res.writeHead(200, { 'Content-Type': MIME['.html'] });
        return res.end(html);
      }

      // Editor runtime assets
      if (p.startsWith('/_pml/')) {
        const abs = path.resolve(EDITOR_DIR, p.slice('/_pml/'.length));
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
