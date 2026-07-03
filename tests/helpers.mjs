// tests/helpers.mjs — shared helpers for the pml test suite.
// Zero external dependencies: only Node.js built-ins.
// Pattern: headless browser via raw Chrome DevTools Protocol
// (fetch /json/list + WebSocket + Runtime.evaluate). No npm packages.

import { spawn } from 'node:child_process';
import fsp from 'node:fs/promises';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const PML_BIN = path.join(ROOT, 'bin/pml.js');

// ── browser ───────────────────────────────────────────────────────────────────

/** Launch a headless browser (brave by default, override via PML_BROWSER env). */
export function launchBrowser(cdpPort) {
  const bin = process.env.PML_BROWSER || 'brave';
  return spawn(bin, [
    '--headless',
    '--disable-gpu',
    `--remote-debugging-port=${cdpPort}`,
    '--window-size=1600,1000',
    'about:blank',
  ], { stdio: 'ignore' });
}

// ── CDP connection ────────────────────────────────────────────────────────────

/**
 * Connect to a running browser on the given CDP port.
 * Polls until the browser responds (up to ~6 s).
 * Returns { send, evl, nav, consoleErrs }.
 */
export async function cdpConnect(cdpPort) {
  let list;
  for (let i = 0; i < 40; i++) {
    try {
      const r = await fetch(`http://localhost:${cdpPort}/json/list`);
      list = await r.json();
      if (list.length) break;
    } catch { /* still starting */ }
    await new Promise(r => setTimeout(r, 150));
  }
  if (!list || !list.length) {
    throw new Error(`Browser on CDP port ${cdpPort} never responded`);
  }

  const ws = new WebSocket(list[0].webSocketDebuggerUrl);
  await new Promise(r => (ws.onopen = r));

  let id = 0;
  const pending = new Map();
  /** Accumulated console errors (reset between pages by callers). */
  const consoleErrs = [];

  ws.onmessage = (m) => {
    const d = JSON.parse(m.data);
    if (d.id && pending.has(d.id)) { pending.get(d.id)(d); pending.delete(d.id); }
    if (d.method === 'Runtime.exceptionThrown') {
      const det = d.params.exceptionDetails;
      consoleErrs.push(
        (det?.text || '') + ' ' + (det?.exception?.description || '')
      );
    }
    if (d.method === 'Runtime.consoleAPICalled' && d.params.type === 'error') {
      consoleErrs.push(
        JSON.stringify(d.params.args?.[0]?.value ?? d.params.args)
      );
    }
  };

  /** Send a CDP command and return the result object. */
  const send = (method, params = {}) => new Promise(res => {
    const i = ++id;
    pending.set(i, res);
    ws.send(JSON.stringify({ id: i, method, params }));
  });

  /** Evaluate JS in the page and return the serialisable result value. */
  const evl = async (expression) => {
    const r = await send('Runtime.evaluate', {
      expression,
      awaitPromise: true,
      returnByValue: true,
    });
    if (r.result?.exceptionDetails) {
      throw new Error(JSON.stringify(r.result.exceptionDetails).slice(0, 300));
    }
    return r.result?.result?.value;
  };

  /** Navigate to url and wait `wait` ms for the page to settle. */
  const nav = async (url, wait = 2200) => {
    await send('Page.navigate', { url });
    await new Promise(r => setTimeout(r, wait));
  };

  await send('Page.enable');
  await send('Runtime.enable');

  return { send, evl, nav, consoleErrs };
}

// ── check / report tally ──────────────────────────────────────────────────────

export const results = [];

export const check = (name, ok) => {
  const passed = !!ok;
  results.push([name, passed]);
  console.log((passed ? 'PASS' : 'FAIL') + '  ' + name);
};

/** Print final tally. Returns the number of failures. */
export const report = () => {
  const fails = results.filter(([, ok]) => !ok).length;
  console.log(
    '\n' + (fails
      ? `${fails} FAILURE${fails === 1 ? '' : 'S'}`
      : `ALL ${results.length} CHECKS PASS`)
  );
  return fails;
};

// ── zero-dep static file server ───────────────────────────────────────────────

const MIME = {
  '.html':  'text/html; charset=utf-8',
  '.css':   'text/css; charset=utf-8',
  '.js':    'text/javascript; charset=utf-8',
  '.json':  'application/json; charset=utf-8',
  '.png':   'image/png',
  '.jpg':   'image/jpeg',
  '.jpeg':  'image/jpeg',
  '.gif':   'image/gif',
  '.svg':   'image/svg+xml',
  '.ico':   'image/x-icon',
  '.woff':  'font/woff',
  '.woff2': 'font/woff2',
};

/**
 * Start a simple static file server that serves `dir` on `port`.
 * Handles correct HTML/CSS/JS MIME types, no directory traversal.
 * Returns the http.Server instance.
 */
export async function startStaticServer(dir, port) {
  const root = path.resolve(dir);
  const server = http.createServer(async (req, res) => {
    try {
      let p = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
      if (p.endsWith('/')) p += 'index.html';
      const abs = path.resolve(root, '.' + p);
      // Security: no directory traversal outside root
      if (!abs.startsWith(root)) {
        res.writeHead(403);
        return res.end('Forbidden');
      }
      const data = await fsp.readFile(abs);
      const ext = path.extname(abs).toLowerCase();
      res.writeHead(200, {
        'Content-Type': MIME[ext] || 'application/octet-stream',
        'Cache-Control': 'no-store',
      });
      res.end(data);
    } catch {
      res.writeHead(404);
      res.end('Not found');
    }
  });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, resolve);
  });
  return server;
}

// ── pml product server ────────────────────────────────────────────────────────

/**
 * Spawn `node bin/pml.js serve <dir> -p <port>` and wait until it responds.
 * Returns the child process.
 */
export async function startPmlServer(dir, port) {
  const proc = spawn('node', [PML_BIN, 'serve', dir, '-p', String(port)], {
    stdio: 'ignore',
  });
  for (let i = 0; i < 40; i++) {
    try {
      const r = await fetch(`http://localhost:${port}/`);
      if (r.status) return proc;
    } catch { /* not up yet */ }
    await new Promise(r => setTimeout(r, 200));
  }
  proc.kill();
  throw new Error(`pml server on port ${port} did not start within 8 s`);
}
