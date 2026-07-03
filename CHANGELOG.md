# Changelog

## 0.2.0 (2026-07-03)

- **Deck hub mode** — point `pml serve` at a folder to get a browsable deck grid with `/d/<name>` routing; create new decks directly from the hub UI
- **Visual editor v2** — grid snap + smart guides, resize handles on selected elements, undo/redo stack, insert menu (text, cards, images with upload), entrance-effect presets
- **Speaker notes + presenter console** — notes panel in the editor (persisted as `<script type="text/pml-notes">` in the slide), dedicated presenter window with current slide, next slide, notes pane, and timer
- **Drag-to-reorder slides** — drag slide cards in the overview to reorder; server renames numeric prefixes atomically
- **Slide layout picker** — "+ New slide" opens a layout chooser (Title, Section, 2-col, Bullets+Card, Quote, Stats, Blank)
- **Print / PDF export** — `/print` route stacks all slides at 1280×720 with `@page` sizing; one click opens the browser print dialog
- **Single-file deck export** — export a whole deck as one self-contained HTML file from the overview
- **Slide/fade presenter transitions** — configurable transition style in presenter mode
- **Browser playground at /app/** — full editor running in-browser with decks stored in localStorage; no install, no server
- **Landing site** — live at [presentations-markup-language.vercel.app](https://presentations-markup-language.vercel.app)
- **Comments with replies + resolve** — pin feedback on slides, thread replies, mark resolved; stored in `comments.json`
- **Renamed package to pmlkit** — npm package is now `pmlkit`; the CLI binary remains `pml`

## 0.1.0

Initial release:

- Zero-dependency Node.js server (no npm dependencies at all)
- Visual editor injected at serve time — click to select, double-click to edit, drag to move, Ctrl+S saves clean HTML
- Comments — pin feedback pins on slides
- Presenter mode — fullscreen, arrow-key navigation, scale-to-fit
- Live reload — file changes update the browser instantly
- CLI (`pml new`, `pml serve`)
- Claude Code and Cursor integration drop-ins in `integration/`
