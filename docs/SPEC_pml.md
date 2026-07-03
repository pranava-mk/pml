# SPEC: pml

Presentations = folder of plain HTML files. Server adds visual editing, comments, live reload. AI agents edit files directly → browser updates live.

## Deck format

```
mydeck/
  deck.json          # {"title", "author", "transition": "slide"|"fade"|"none"}
  theme.css          # shared styles, fonts, fx preset classes
  slides/
    01-title.html    # one file = one slide, sorted by filename
    02-agenda.html
  assets/            # uploaded images (server-managed)
  comments.json      # server-managed, do not hand-edit
  .trash/            # soft-deleted slides land here, never unlinked
```

Slide contract:
- Full standalone HTML doc. Opens directly in browser, no server needed.
- Links `../theme.css`.
- Body contains single root `<div class="slide">`, fixed 1280×720 canvas.
- No external JS. Slides = pure markup + CSS.

## Server (src/server/index.js)

Zero npm deps. Node ≥20 (fs.watch recursive, SSE via raw http).

Two modes, auto-detected:
- **deck mode** — served dir has `slides/` → routes below at `/`
- **hub mode** — served dir contains deck subdirs → hub page at `/` (deck grid,
  create deck), every deck route below prefixed `/d/<name>`. `POST /api/decks`
  `{name}` scaffolds a new deck from `templates/deck/`. Editor gets
  `__PML__.base` + `.evPrefix` and prefixes all API calls/links.

| Route | Does |
|---|---|
| `GET /` | Deck overview: slide grid, edit/present links |
| `GET /present` | Fullscreen presenter, ←/→ keys, scale-to-fit |
| `GET /edit/:file` | Slide HTML + injected editor runtime |
| `GET /slides/:file` | Raw slide (iframes use this) |
| `GET /_pml/*` | Editor runtime assets (src/editor) |
| `GET /export` | Whole deck as ONE self-contained HTML file (`?download=1` = attachment) |
| `GET /export/:file` | Single slide with theme.css inlined (standalone download) |
| `GET /events` | SSE stream: `{type:"change", file}` on disk change |
| `POST /api/save` | `{file, html}` → write slide to disk |
| `POST /api/deck` | `{title?, transition?}` → update deck.json |
| `POST /api/slide` | `{action: "new"\|"duplicate"\|"rename"\|"delete", file, name?}` — delete = move to `.trash/`; rename keeps NN prefix, slugifies name |
| `POST /api/upload` | `{name, data: dataURL}` → `assets/`, returns `{path}` |
| `GET /api/comments?file=` | Comments for slide |
| `POST /api/comments` | Add comment `{file, x, y, author, text}` |
| `POST /api/comments/:id/resolve` | Toggle resolved |
| `POST /api/comments/:id/reply` | Add reply `{author, text}` |

Self-save suppression: server hashes what it writes; watcher skips events matching recent own-writes (2s window).

## Editor runtime (src/editor/)

Vanilla JS + CSS, injected before `</body>` on `/edit/` routes.

- Click = select (outline + resize handles e/s/se). Esc = deselect.
- Dblclick = inline text edit (contenteditable, blur ends).
- Toolbar: font family, size, weight, italic, color, align, effect preset + delay, duplicate, delete, insert menu (heading/text/bullets/card/image URL/image upload), undo/redo, snap toggle.
- Drag selected element = move (converts to `position:absolute`). Snap: 8px grid + smart guides to slide edges/center + sibling edges/centers (6px magnet, Alt bypasses, 🧲 toggles). Arrows nudge 1px, Shift+arrows 10px.
- Undo/redo: slide-level snapshots (max 60), throttled per action type. Ctrl+Z / Ctrl+Shift+Z / Ctrl+Y. Ctrl+D duplicates.
- Entrance effects: `.fx-fade-in|fade-up|zoom-in|slide-left|slide-right|blur-in` + `--fx-delay` inline var. Classes defined in template theme.css; editor also injects `<style data-pml-fx>` (persisted) so any deck stays self-contained.
- Comment mode: click drops pin (% coords), panel to write; sidebar lists + reply + resolve.
- Ctrl+S / Save button → strips all injected artifacts (`data-pml-ui`, `data-pml-runtime`; keeps `data-pml-font` links + `data-pml-fx` style), serializes doc, POSTs to `/api/save`.
- Live reload: clean → auto reload on disk change; dirty → warning bar with manual reload.

## Presenter

Transitions between slides per `deck.json` `"transition"`: `slide` (default), `fade`, `none`. Touch swipe navigates. Entrance fx replay naturally on slide load.

## Overview / hub UI (no-AI-needed editing)

Overview: per-slide duplicate/delete (soft) + click-name-to-rename, ＋ New slide, ⇩ Export, deck title contenteditable (saves to deck.json), back-link to hub. Hub: deck grid with present/export shortcuts, ＋ New deck modal. All controls have aria-labels + focus-visible styles.

## Landing site (site/)

`site/index.html` — self-contained, GSAP (CDN) page that IS a deck: hard slide-snap engine (wheel burst/swipe/keys/dots/header-nav = exactly one slide, no in-between scroll), custom cursor dot+ring+glow, magnetic buttons, per-panel staggers, typing terminal. Mobile keeps deck behavior via swipe. Reduced-motion = instant jumps. No build step.

## CLI (bin/pml.js)

- `pml new <name>` — scaffold deck from `templates/deck/`
- `pml serve [dir] [--port N]` — start server (default: cwd, port 4321)

## AI integration (integration/)

Drop-in files for users' existing setups:
- `integration/claude/skills/pml-slides/SKILL.md` — Claude Code skill
- `integration/AGENTS.md` — snippet for Cursor rules / AGENTS.md / any agent

Flow: agent edits slide HTML files → server watcher → browser live-reloads. Human edits visually in browser → save → file on disk → agent sees changes. Both directions, no API, just files.

## Non-goals (v1)

- No auth, no multi-user sync (single local server).
- No export to PPTX/PDF (browser print works).
- No build step, no framework, no bundler.
