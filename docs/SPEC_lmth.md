# SPEC: lmth

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

| Route | Does |
|---|---|
| `GET /` | Deck overview: slide grid, edit/present links |
| `GET /present` | Fullscreen presenter, ←/→ keys, scale-to-fit |
| `GET /edit/:file` | Slide HTML + injected editor runtime |
| `GET /slides/:file` | Raw slide (iframes use this) |
| `GET /_lmth/*` | Editor runtime assets (src/editor) |
| `GET /export` | Whole deck as ONE self-contained HTML file (`?download=1` = attachment) |
| `GET /export/:file` | Single slide with theme.css inlined (standalone download) |
| `GET /events` | SSE stream: `{type:"change", file}` on disk change |
| `POST /api/save` | `{file, html}` → write slide to disk |
| `POST /api/slide` | `{action: "new"\|"duplicate"\|"delete", file}` — delete = move to `.trash/` |
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
- Entrance effects: `.fx-fade-in|fade-up|zoom-in|slide-left|slide-right|blur-in` + `--fx-delay` inline var. Classes defined in template theme.css; editor also injects `<style data-lmth-fx>` (persisted) so any deck stays self-contained.
- Comment mode: click drops pin (% coords), panel to write; sidebar lists + reply + resolve.
- Ctrl+S / Save button → strips all injected artifacts (`data-lmth-ui`, `data-lmth-runtime`; keeps `data-lmth-font` links + `data-lmth-fx` style), serializes doc, POSTs to `/api/save`.
- Live reload: clean → auto reload on disk change; dirty → warning bar with manual reload.

## Presenter

Transitions between slides per `deck.json` `"transition"`: `slide` (default), `fade`, `none`. Entrance fx replay naturally on slide load. Overview has per-slide duplicate/delete (soft), ＋ New slide, ⇩ Export.

## Landing site (site/)

`site/index.html` — self-contained, GSAP (CDN) horizontal-scroll page structured as a presentation: pinned track, snap per panel, dot nav, ←/→ keys, progress bar, cursor glow, typing terminal. Vertical fallback for `prefers-reduced-motion` and ≤860px. No build step.

## CLI (bin/lmth.js)

- `lmth new <name>` — scaffold deck from `templates/deck/`
- `lmth serve [dir] [--port N]` — start server (default: cwd, port 4321)

## AI integration (integration/)

Drop-in files for users' existing setups:
- `integration/claude/skills/lmth-slides/SKILL.md` — Claude Code skill
- `integration/AGENTS.md` — snippet for Cursor rules / AGENTS.md / any agent

Flow: agent edits slide HTML files → server watcher → browser live-reloads. Human edits visually in browser → save → file on disk → agent sees changes. Both directions, no API, just files.

## Non-goals (v1)

- No auth, no multi-user sync (single local server).
- No export to PPTX/PDF (browser print works).
- No build step, no framework, no bundler.
