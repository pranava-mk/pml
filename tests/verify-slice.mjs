// tests/verify-slice.mjs — functional verification of the editor-UX + theme slice.
// Insert rail, theme switcher (+ .trash backup), multi-select, align-to-slide,
// text-range styling. Zero-dep raw CDP, mirrors run.mjs. Restores files after.
//   node tests/verify-slice.mjs   (PML_BROWSER=chrome to override brave)

import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import {
  launchBrowser, cdpConnect, startPmlServer, check, report,
} from './helpers.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const EXAMPLES = path.join(ROOT, 'examples');
const DECK = path.join(EXAMPLES, 'launch');
const THEME_CSS = path.join(DECK, 'theme.css');
const TRASH = path.join(DECK, '.trash');
const SLIDE_01 = path.join(DECK, 'slides', '01-title.html');

const PORT = 4471, CDP = 9471;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const apiFetch = (url, opt) => fetch(url, opt).then(async (r) => ({ status: r.status, body: await r.text() }));

let pmlServer = null, browser = null;
const origSlide01 = fs.readFileSync(SLIDE_01, 'utf8');

try {
  pmlServer = await startPmlServer(EXAMPLES, PORT);
  browser = launchBrowser(CDP);
  const { evl, nav } = await cdpConnect(CDP);
  const base = `http://localhost:${PORT}/d/launch`;

  // ── 1. Theme switcher UI on overview ────────────────────────────────────────
  await nav(`${base}/`, 2500);
  check('theme: 🎨 button present on overview', await evl(`!!document.getElementById('theme-btn')`));
  await evl(`document.getElementById('theme-btn').click()`);
  await sleep(300);
  check('theme: modal opens', await evl(`!document.getElementById('theme-modal').hidden`));
  check('theme: grid has 3 preset cards',
    (await evl(`document.querySelectorAll('#theme-grid [role="button"]').length`)) === 3);

  // ── 2. Theme write path (server) + .trash backup ────────────────────────────
  const before = fs.existsSync(TRASH) ? fs.readdirSync(TRASH).length : 0;
  const r = await apiFetch(`${base}/api/deck`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ theme: 'neon' }),
  });
  check('theme: POST /api/deck {theme:neon} → 200', r.status === 200);
  const css = fs.readFileSync(THEME_CSS, 'utf8');
  check('theme: theme.css rewritten with neon accent (#00ff9d)', css.includes('#00ff9d'));
  const after = fs.existsSync(TRASH) ? fs.readdirSync(TRASH).filter((f) => f.startsWith('theme-')).length : 0;
  check('theme: previous theme.css backed up to .trash', after > before);
  const bad = await apiFetch(`${base}/api/deck`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ theme: 'does-not-exist' }),
  });
  check('theme: unknown theme id rejected (400)', bad.status === 400);

  // ── 3. Editor: insert rail ──────────────────────────────────────────────────
  await nav(`${base}/edit/01-title.html`, 2800);
  const baseCount = await evl(`document.querySelectorAll('.slide > *:not([data-pml-ui])').length`);
  await evl(`document.getElementById('pml-insert').click()`);
  await sleep(300);
  check('rail: opens (.pml-rail.open + html.pml-rail-open)',
    await evl(`document.querySelector('.pml-rail').classList.contains('open') && document.documentElement.classList.contains('pml-rail-open')`));
  check('rail: has 4 tabs (Text/Shapes/Icons/Images)',
    (await evl(`document.querySelectorAll('.pml-rail-tab').length`)) === 4);
  // switch to Shapes tab, click first tile → element inserted
  await evl(`[...document.querySelectorAll('.pml-rail-tab')].find(t => t.textContent === 'Shapes').click()`);
  await sleep(150);
  await evl(`document.querySelector('.pml-rail-tile').click()`);
  await sleep(200);
  const afterCount = await evl(`document.querySelectorAll('.slide > *:not([data-pml-ui])').length`);
  check(`rail: Shapes tile inserts element (${baseCount} → ${afterCount})`, afterCount === baseCount + 1);

  // ── 4. Align-to-slide (centre horizontally) ─────────────────────────────────
  const centered = await evl(`(() => {
    const n = document.querySelector('.slide > *:not([data-pml-ui])');
    n.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    window.dispatchEvent(new MouseEvent('mouseup'));
    document.querySelector('[data-salign="c"]').click();
    const w = n.getBoundingClientRect().width / (parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--pml-zoom')) || 1);
    const expected = Math.round((1280 - w) / 2);
    return { left: Math.round(parseFloat(n.style.left) || -1), expected };
  })()`);
  check(`align: centre-h sets left≈(1280-w)/2 (${centered.left} vs ${centered.expected})`,
    Math.abs(centered.left - centered.expected) <= 2);

  // ── 5. Multi-select (shift-click → two selected) ────────────────────────────
  const selCount = await evl(`(() => {
    const els = [...document.querySelectorAll('.slide > *:not([data-pml-ui])')].slice(0, 2);
    els[0].dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    window.dispatchEvent(new MouseEvent('mouseup'));
    els[1].dispatchEvent(new MouseEvent('mousedown', { bubbles: true, shiftKey: true }));
    window.dispatchEvent(new MouseEvent('mouseup'));
    return document.querySelectorAll('.slide .pml-selected').length;
  })()`);
  check(`multi-select: shift-click → 2 selected (got ${selCount})`, selCount === 2);

  // ── 6. Text-range styling (bold a sub-range) ────────────────────────────────
  const boldOk = await evl(`(() => {
    const h = document.querySelector('h1.title') || document.querySelector('.slide [contenteditable], .slide h1, .slide p');
    if (!h) return false;
    h.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    window.dispatchEvent(new MouseEvent('mouseup'));
    h.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
    const tn = [...h.childNodes].find(n => n.nodeType === 3 && n.textContent.trim().length > 2) || h.firstChild;
    if (!tn) return false;
    const rng = document.createRange();
    rng.setStart(tn, 0); rng.setEnd(tn, Math.min(3, tn.textContent.length));
    const sel = getSelection(); sel.removeAllRanges(); sel.addRange(rng);
    const before = h.innerHTML;
    document.getElementById('pml-bold').click();
    const after = h.innerHTML;
    return after !== before && /<b>|font-weight|<span/i.test(after);
  })()`);
  check('text-range: bold wraps only the sub-selection', boldOk);

} finally {
  // restore tracked files touched by this run
  try { execFileSync('git', ['checkout', '--', THEME_CSS], { cwd: ROOT }); } catch {}
  fs.writeFileSync(SLIDE_01, origSlide01);
  try { for (const f of fs.readdirSync(TRASH)) if (f.startsWith('theme-')) fs.rmSync(path.join(TRASH, f)); } catch {}
  if (browser) try { browser.kill(); } catch {}
  if (pmlServer) try { pmlServer.kill(); } catch {}
}

process.exit(report());
