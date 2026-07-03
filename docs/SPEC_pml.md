# SPEC: pml

Presentations = folder of plain HTML files. Server adds visual editing, comments, live reload. AI agents edit files directly → browser updates live.

## Deck format

```
mydeck/
  deck.json          # {"title": "...", "author": "..."}
  theme.css          # shared styles, fonts
  slides/
    01-title.html    # one file = one slide, sorted by filename
    02-agenda.html
  comments.json      # server-managed, do not hand-edit
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
| `GET /_pml/*` | Editor runtime assets (src/editor) |
| `GET /events` | SSE stream: `{type:"change", file}` on disk change |
| `POST /api/save` | `{file, html}` → write slide to disk |
| `GET /api/comments?file=` | Comments for slide |
| `POST /api/comments` | Add comment `{file, x, y, author, text}` |
| `POST /api/comments/:id/resolve` | Mark resolved |

Self-save suppression: server hashes what it writes; watcher skips events matching recent own-writes (2s window).

## Editor runtime (src/editor/)

Vanilla JS + CSS, injected before `</body>` on `/edit/` routes.

- Click = select (outline + tag label). Esc = deselect.
- Dblclick = inline text edit (contenteditable, blur ends).
- Toolbar: font family, size, weight, italic, color, align, duplicate, delete.
- Drag selected element = move (converts to `position:absolute` within slide). Arrows nudge 1px, Shift+arrows 10px.
- Comment mode: click drops pin (% coords), panel to write; sidebar lists + resolve.
- Ctrl+S / Save button → strips all injected artifacts, serializes doc, POSTs to `/api/save`.
- Live reload: clean → auto reload on disk change; dirty → warning bar with manual reload.

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
