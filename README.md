# pml — presentation markup language

**Presentations are just files.**

🌐 **[presentations-markup-language.vercel.app](https://presentations-markup-language.vercel.app)** · ⚡ **[Try the app — no install](https://presentations-markup-language.vercel.app/app/)** Plain HTML slides with visual editing, comments, presenter mode, and live reload — built to sit inside the AI coding workflow you already use.

> **Not yet on npm.** The `npx pmlkit` commands below describe the intended
> install path once published — for now, clone the repo and use `node bin/pml.js`
> as shown in "From a local clone."

Once published:

```bash
npx pmlkit new my-deck
cd my-deck && npx pmlkit serve
# CLI is `pml` when installed globally: npm i -g pmlkit
```

**From a local clone** (works today):

```bash
git clone https://github.com/pranava-mk/pml.git
cd pml
node bin/pml.js new my-deck
cd my-deck && node ../bin/pml.js serve
# → http://localhost:4321
```

Or try the showcase hub with three example decks: `npm run demo`

**Zero install:** the hosted browser playground at `/app/` on the site runs the
full editor with decks stored in your browser.

Point `pml serve` at one deck **or at a folder of decks** — the folder gives you
a hub page to browse, create and present decks. No AI required anywhere:
everything (create deck, add/rename/reorder slides, restyle, comment, export)
works from the browser UI.

## What you get

- **Hub** — folder of decks → deck grid, ＋ New deck, present/export shortcuts
- **Overview** — slide grid; new / duplicate / rename / delete slides, editable deck title, one-click export
- **Editor** (`/edit/<slide>`) — click to select, double-click to edit text, drag with grid snap + smart guides, resize handles, undo/redo, insert menu (text, cards, images incl. upload), fonts / sizes / colors / align, entrance-effect presets, Ctrl+S writes clean HTML back to disk
- **Comments** — pin feedback on slides, reply, resolve; stored in `comments.json`
- **Presenter** (`/present`) — fullscreen, arrow keys, slide/fade transitions, scale-to-fit
- **Export** (`/export`) — whole deck as one self-contained HTML file; per-slide standalone export too
- **Live reload** — any file change (yours or your AI agent's) updates the browser instantly

## The AI loop

Slides are plain HTML files, so any agent — Claude Code, Cursor, whatever — can create and edit them natively. Run `pml serve`, prompt your agent, watch the deck build itself. Edit visually in the browser; the agent sees your changes as file diffs. See [`integration/`](integration/README.md) for one-line setup.

## Deck format

```
my-deck/
  deck.json        # {"title": "..."}
  theme.css        # shared styles
  slides/
    01-title.html  # one standalone HTML file per slide, 1280×720
    02-agenda.html
  comments.json    # feedback pins (server-managed)
```

Every slide opens in a browser with zero tooling. Git is your history, review, and sharing layer.

Zero npm dependencies. Node ≥ 20. Full contract: [`docs/SPEC_pml.md`](docs/SPEC_pml.md).
