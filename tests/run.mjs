// tests/run.mjs — pml end-to-end test suite.
// Covers: product hub/overview/editor (hub mode), landing slide engine,
// browser playground. Zero dependencies — raw CDP, no test framework.
//
// Usage: node tests/run.mjs
//   or:  npm test
//   or:  PML_BROWSER=chrome npm test

import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  launchBrowser, cdpConnect,
  startStaticServer, startPmlServer,
  check, report, results,
} from './helpers.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT       = path.resolve(__dirname, '..');

const PML_PORT    = 4461;  // pml hub server  (examples/)
const STATIC_PORT = 4462;  // static server   (site/)
const CDP_PORT    = 9461;  // browser CDP port

const EXAMPLES_DIR    = path.join(ROOT, 'examples');
const LAUNCH_SLIDES   = path.join(ROOT, 'examples/launch/slides');
const LAUNCH_TRASH    = path.join(ROOT, 'examples/launch/.trash');
const SLIDE_01        = path.join(LAUNCH_SLIDES, '01-title.html');

// Save original content up front — restored in finally regardless of failures.
const origSlide01 = fs.readFileSync(SLIDE_01, 'utf8');

// Resources to clean up in finally.
let browser     = null;
let pmlServer   = null;
let staticServer = null;

// ─── helpers used inside tests ────────────────────────────────────────────────

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

const apiFetch = (url, body = null) =>
  fetch(url, body
    ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }
    : { method: 'GET' });

// ─── main ─────────────────────────────────────────────────────────────────────

try {
  // ── start servers ───────────────────────────────────────────────────────────
  pmlServer    = await startPmlServer(EXAMPLES_DIR, PML_PORT);
  staticServer = await startStaticServer(path.join(ROOT, 'site'), STATIC_PORT);

  // ── launch browser ──────────────────────────────────────────────────────────
  browser = launchBrowser(CDP_PORT);
  const { send, evl, nav, consoleErrs } = await cdpConnect(CDP_PORT);

  // ═══════════════════════════════════════════════════════════════════════════
  // A.  PRODUCT  (hub mode, pml serve examples/ on PML_PORT)
  // ═══════════════════════════════════════════════════════════════════════════

  // ── A1. Hub page ────────────────────────────────────────────────────────────
  consoleErrs.length = 0;
  await nav(`http://localhost:${PML_PORT}/`, 2500);
  check('hub: no console errors', consoleErrs.length === 0);
  check('hub: 3 deck cards', (await evl(`document.querySelectorAll('.deck-card').length`)) === 3);
  await evl(`document.getElementById('new-deck').click()`);
  await sleep(300);
  check('hub: new-deck modal opens', await evl(`!document.getElementById('modal').hidden`));
  await evl(`document.getElementById('modal-cancel').click()`);

  // ── A2. Deck overview (boardroom) ───────────────────────────────────────────
  consoleErrs.length = 0;
  await nav(`http://localhost:${PML_PORT}/d/boardroom/`, 2500);
  check('overview: no console errors', consoleErrs.length === 0);
  check('overview: editable #deck-title', await evl(`document.getElementById('deck-title').isContentEditable`));
  check('overview: .name.rename elements present', (await evl(`document.querySelectorAll('.name.rename').length`)) > 0);
  check('overview: back-to-hub link', await evl(`!!document.querySelector('.back')`));
  check('overview: cards are draggable', (await evl(`document.querySelectorAll('.card[data-file][draggable]').length`)) > 0);
  check('overview: ⎙ PDF link present', await evl(`!!document.querySelector('a[href*="print"]')`));

  // layout modal
  await evl(`document.getElementById('new-slide').click()`);
  await sleep(350);
  check('overview: layout modal opens on + New slide', await evl(`!document.getElementById('layout-modal').hidden`));
  const layoutBtnCount = await evl(`document.querySelectorAll('#layout-grid button').length`);
  check(`overview: layout modal has ≥6 layout buttons (${layoutBtnCount})`, layoutBtnCount >= 6);
  await evl(`document.getElementById('layout-cancel').click()`);

  // ── A3. APIs (plain Node fetch — no browser) ────────────────────────────────

  // Create new slide with quote layout.
  const newSlideR = await apiFetch(`http://localhost:${PML_PORT}/d/launch/api/slide`,
    { action: 'new', layout: 'quote' });
  const newSlideD = await newSlideR.json();
  check('api: POST new slide (quote) succeeds', !!newSlideD.ok && !!newSlideD.file);
  const newFileName = newSlideD.file; // e.g. "07-quote.html"

  // Verify file exists and contains the quote layout marker.
  const newFilePath = path.join(LAUNCH_SLIDES, newFileName);
  const newFileContent = fs.readFileSync(newFilePath, 'utf8');
  check('api: new slide file contains "quotable"', newFileContent.includes('quotable'));

  // GET current slide list.
  const slidesR1  = await apiFetch(`http://localhost:${PML_PORT}/d/launch/api/slides`);
  const slidesD1  = await slidesR1.json();
  const slidesBefore = slidesD1.slides; // includes newFileName
  check('api: GET /api/slides returns array with new slide', Array.isArray(slidesBefore) && slidesBefore.includes(newFileName));

  // Reorder: reverse the list.
  const reversedOrder = [...slidesBefore].reverse();
  const reorderR = await apiFetch(`http://localhost:${PML_PORT}/d/launch/api/slide`,
    { action: 'reorder', order: reversedOrder });
  const reorderD = await reorderR.json();
  check('api: reorder reversed list succeeds', !!reorderD.ok);

  // Verify via GET — first slide should have the quote content.
  const slidesR2 = await apiFetch(`http://localhost:${PML_PORT}/d/launch/api/slides`);
  const slidesD2 = await slidesR2.json();
  const slidesReversed = slidesD2.slides;
  const firstAfterReorder = path.join(LAUNCH_SLIDES, slidesReversed[0]);
  const firstContent = fs.readFileSync(firstAfterReorder, 'utf8');
  check('api: after reorder first file has reversed content ("quotable")', firstContent.includes('quotable'));

  // Reorder back (reverse the reversed list → original order).
  const reorderBackR = await apiFetch(`http://localhost:${PML_PORT}/d/launch/api/slide`,
    { action: 'reorder', order: [...slidesReversed].reverse() });
  const reorderBackD = await reorderBackR.json();
  check('api: reorder-back succeeds', !!reorderBackD.ok);

  // Verify original order restored (new slide is last again).
  const slidesR3 = await apiFetch(`http://localhost:${PML_PORT}/d/launch/api/slides`);
  const slidesD3 = await slidesR3.json();
  const slidesRestored = slidesD3.slides;
  check('api: after reorder-back original filenames restored',
    slidesRestored[0] === '01-title.html' && slidesRestored[slidesRestored.length - 1].includes('quote'));

  // /print — one .pg block per slide.
  const printR = await apiFetch(`http://localhost:${PML_PORT}/d/launch/print`);
  const printHtml = await printR.text();
  const pgCount = (printHtml.match(/class="pg"/g) || []).length;
  const expectedSlides = slidesRestored.length;
  check(`api: GET /print has ${expectedSlides} .pg blocks (got ${pgCount})`, pgCount === expectedSlides);

  // /presenter — must contain BroadcastChannel.
  const presR  = await apiFetch(`http://localhost:${PML_PORT}/d/launch/presenter`);
  const presHtml = await presR.text();
  check('api: GET /presenter contains BroadcastChannel', presHtml.includes('BroadcastChannel'));

  // Delete the new slide file directly from disk + remove .trash.
  const quoteFile = path.join(LAUNCH_SLIDES, slidesRestored[slidesRestored.length - 1]);
  if (fs.existsSync(quoteFile) && fs.readFileSync(quoteFile, 'utf8').includes('quotable')) {
    fs.unlinkSync(quoteFile);
  }
  if (fs.existsSync(LAUNCH_TRASH)) {
    fs.rmSync(LAUNCH_TRASH, { recursive: true, force: true });
  }

  // ── A4. Editor: autosave + notes + save-cleanliness ─────────────────────────
  consoleErrs.length = 0;
  await nav(`http://localhost:${PML_PORT}/d/launch/edit/01-title.html`, 2800);
  check('editor: no console errors on load', consoleErrs.length === 0);

  // AUTOSAVE: select h1 → change size to 97 → wait 2.6 s WITHOUT Ctrl+S.
  await evl(`(() => {
    const h1 = document.querySelector('h1.title');
    h1.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    window.dispatchEvent(new MouseEvent('mouseup'));
    const size = document.querySelector('#pml-size');
    size.value = '97';
    size.dispatchEvent(new Event('input', { bubbles: true }));
  })()`);
  await sleep(2600);
  const savedAuto = fs.readFileSync(SLIDE_01, 'utf8');
  check('editor: autosave wrote 97px to file (no Ctrl+S needed)', savedAuto.includes('97px'));

  // SAVE CLEANLINESS: no editor-only attributes in persisted file.
  check('editor: saved file has no data-pml-ui', !savedAuto.includes('data-pml-ui'));
  check('editor: saved file has no pml-selected', !savedAuto.includes('pml-selected'));
  check('editor: saved file has no data-pml-runtime', !savedAuto.includes('data-pml-runtime'));

  // NOTES: open panel → type → wait 2.6 s → file contains pml-notes script.
  await evl(`document.getElementById('pml-notes-btn').click()`);
  await sleep(350);
  await evl(`(() => {
    const ta = document.getElementById('pml-notes-ta');
    ta.value = 'Autosave notes test';
    ta.dispatchEvent(new Event('input', { bubbles: true }));
  })()`);
  await sleep(2600);
  const savedNotes = fs.readFileSync(SLIDE_01, 'utf8');
  check('editor: notes autosave persisted text/pml-notes script tag', savedNotes.includes('text/pml-notes'));

  // Restore original file immediately after editor tests.
  fs.writeFileSync(SLIDE_01, origSlide01);

  // ═══════════════════════════════════════════════════════════════════════════
  // B.  LANDING  (site/ served statically on STATIC_PORT)
  // ═══════════════════════════════════════════════════════════════════════════

  // Reset to desktop viewport before landing tests.
  await send('Emulation.clearDeviceMetricsOverride', {});

  consoleErrs.length = 0;
  await nav(`http://localhost:${STATIC_PORT}/`, 3200);
  check('landing: no console errors', consoleErrs.length === 0);
  // Stagger animation takes ~1.6s after load — poll instead of racing it.
  check('landing: hero h1 visible (opacity 1)',
    await evl(`(async () => {
      for (let i = 0; i < 20; i++) {
        const h = document.querySelector('.hero h1');
        if (h && getComputedStyle(h).opacity === '1') return true;
        await new Promise((r) => setTimeout(r, 250));
      }
      return false;
    })()`));

  // ArrowRight → snaps exactly to -innerWidth (1600 px at 1600×1000).
  await evl(`dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }))`);
  await sleep(1100);
  const lx1 = await evl(`gsap.getProperty('#track', 'x')`);
  check(`landing: ArrowRight snaps EXACTLY to -innerWidth (x=${lx1})`, lx1 === -1600);

  // Wheel burst of 6 → lock fires, advances exactly ONE slide.
  await evl(`for (let i = 0; i < 6; i++) dispatchEvent(new WheelEvent('wheel', { deltaY: 140, cancelable: true }))`);
  await sleep(1200);
  const lx2 = await evl(`gsap.getProperty('#track', 'x')`);
  check(`landing: wheel burst of 6 advances exactly one slide (x=${lx2})`, lx2 === -3200);

  // Nav button data-goto=5 → x = -5 * innerWidth.
  await evl(`document.querySelector('#main-nav button[data-goto="5"]').click()`);
  await sleep(1100);
  const lx3 = await evl(`gsap.getProperty('#track', 'x')`);
  check(`landing: nav data-goto=5 lands at -5×width (x=${lx3})`, lx3 === -8000);

  // ── B mobile: 390×844 portrait ──────────────────────────────────────────────
  await send('Emulation.setDeviceMetricsOverride', {
    width: 390, height: 844, deviceScaleFactor: 2, mobile: true,
  });
  await send('Emulation.setTouchEmulationEnabled', { enabled: true });
  await nav(`http://localhost:${STATIC_PORT}/`, 3000);

  const rotMatrix = await evl(`getComputedStyle(document.getElementById('app')).transform`);
  check(`landing mobile portrait: #app has 90° rotation (${rotMatrix?.slice(0, 25)})`,
    typeof rotMatrix === 'string' && rotMatrix.startsWith('matrix(0, 1, -1, 0'));

  // Swipe up (y 700→300) should advance one slide in portrait-rotated mode.
  await send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: 200, y: 700 }] });
  await send('Input.dispatchTouchEvent', { type: 'touchMove',  touchPoints: [{ x: 200, y: 300 }] });
  await send('Input.dispatchTouchEvent', { type: 'touchEnd',   touchPoints: [] });
  await sleep(1100);
  const mx = await evl(`gsap.getProperty('#track', 'x')`);
  check(`landing mobile portrait: swipe-up advances one slide (x=${mx})`, mx === -844);

  // ── B mobile: 844×390 landscape → no rotation ───────────────────────────────
  await send('Emulation.setDeviceMetricsOverride', {
    width: 844, height: 390, deviceScaleFactor: 2, mobile: true,
  });
  await nav(`http://localhost:${STATIC_PORT}/`, 2500);
  const rotLandscape = await evl(`getComputedStyle(document.getElementById('app')).transform`);
  check(`landing landscape 844×390: no CSS rotation (${rotLandscape})`, rotLandscape === 'none');

  // Restore desktop metrics for playground section.
  await send('Emulation.clearDeviceMetricsOverride', {});
  await send('Emulation.setTouchEmulationEnabled', { enabled: false });

  // ═══════════════════════════════════════════════════════════════════════════
  // C.  PLAYGROUND  (site/app/ on same STATIC_PORT)
  // ═══════════════════════════════════════════════════════════════════════════

  // Navigate once to establish page origin, then clear stale state & reload.
  await nav(`http://localhost:${STATIC_PORT}/app/`, 1000);
  await evl(`localStorage.removeItem('pml-decks-v1')`);

  consoleErrs.length = 0;
  await nav(`http://localhost:${STATIC_PORT}/app/`, 2500);
  check('playground: no console errors on load', consoleErrs.length === 0);
  check('playground: starter deck seeded (1 card)',
    (await evl(`document.querySelectorAll('.card[data-slug]').length`)) === 1);

  // New-deck modal.
  await evl(`document.getElementById('new-deck').click()`);
  await sleep(300);
  check('playground hub: new-deck modal opens', await evl(`!document.getElementById('modal').hidden`));
  await evl(`document.getElementById('modal-cancel').click()`);

  // Overview — 3 slides.
  await evl(`location.hash = '#/d/my-first-deck'`);
  await sleep(1500);
  const appSlides = await evl(`document.querySelectorAll('.card[data-file]').length`);
  check(`playground overview: 3 slides (got ${appSlides})`, appSlides === 3);

  // Editor — navigate into first slide.
  consoleErrs.length = 0;
  await evl(`location.hash = '#/d/my-first-deck/edit/01-title.html'`);
  await sleep(3200);
  check('playground editor: no console errors', consoleErrs.length === 0);
  const hasBar = await evl(
    `!!document.querySelector('#frame-view iframe')?.contentDocument?.querySelector('.pml-bar')`
  );
  check('playground editor: iframe contains .pml-bar toolbar', hasBar);

  // Autosave through bridge: change size → wait 2.6 s → check localStorage.
  const sizeReachable = await evl(`(async () => {
    const iframe = document.querySelector('#frame-view iframe');
    if (!iframe) return false;
    const doc = iframe.contentDocument;
    const win = iframe.contentWindow;
    const h1 = doc.querySelector('h1.title');
    if (!h1) return false;
    h1.dispatchEvent(new win.MouseEvent('mousedown', { bubbles: true }));
    win.dispatchEvent(new win.MouseEvent('mouseup'));
    const size = doc.querySelector('#pml-size');
    if (!size) return false;
    size.value = '93';
    size.dispatchEvent(new win.Event('input', { bubbles: true }));
    return true;
  })()`);
  check('playground editor: size control reachable in iframe', !!sizeReachable);

  await sleep(2600);

  const bridgeSaved = await evl(`(() => {
    try {
      const state = JSON.parse(localStorage.getItem('pml-decks-v1'));
      const slide = state?.decks?.['my-first-deck']?.slides?.find(s => s.name === '01-title.html');
      return !!slide?.html?.includes('93px');
    } catch { return false; }
  })()`);
  check('playground editor: autosave persisted 93px to localStorage via bridge', bridgeSaved);

  // Clear localStorage — leave playground in pristine state.
  await evl(`localStorage.removeItem('pml-decks-v1')`);

} finally {
  // ── Restore all modified example files ──────────────────────────────────────
  try {
    fs.writeFileSync(SLIDE_01, origSlide01);
  } catch { /* ignore */ }

  // Delete any stray quote slide left by API tests (identified by content).
  try {
    const files = fs.readdirSync(LAUNCH_SLIDES).filter(f => f.endsWith('.html'));
    for (const f of files) {
      const full = path.join(LAUNCH_SLIDES, f);
      const content = fs.readFileSync(full, 'utf8');
      if (content.includes('Someone quotable')) {
        fs.unlinkSync(full);
      }
    }
  } catch { /* ignore */ }

  // Remove .trash if it was created.
  try {
    if (fs.existsSync(LAUNCH_TRASH)) {
      fs.rmSync(LAUNCH_TRASH, { recursive: true, force: true });
    }
  } catch { /* ignore */ }

  // Kill all spawned processes.
  if (browser)      browser.kill();
  if (pmlServer)    pmlServer.kill();
  if (staticServer) staticServer.close();
}

// ── exit code ─────────────────────────────────────────────────────────────────
const failures = report();
process.exit(failures ? 1 : 0);
