# Contributing to pml

## Dev setup

Requirements: Node ≥ 20, git. No build step. No runtime dependencies.

```bash
git clone https://github.com/pranava-mk/pml.git
cd pml
npm run demo
# → http://localhost:4321 — serves the example decks
```

That's it. There is nothing to install and nothing to compile.

**The zero-dependency rule is hard.** PRs that add entries to `dependencies` or `devDependencies` in `package.json` will be declined. If you need a utility, inline it or write it from scratch — the codebase already does this throughout (HTTP server, live-reload, file watcher, CDP test runner — all hand-rolled).

## Project map

```
bin/            CLI entry point — argument parsing, command dispatch
src/server/     Zero-dependency HTTP server (deck hub, editor API, presenter, export)
src/editor/     Editor runtime injected into slides at serve time
templates/      Deck scaffold (new deck, slide layouts as HTML strings)
site/           Landing page + browser playground at /app/
integration/    Claude Code and Cursor drop-in config files
docs/SPEC_pml.md  The deck format contract
```

**Change discipline:** the SPEC is the source of truth. If you're changing the on-disk format, update `docs/SPEC_pml.md` first, then the code, then verify that `integration/` still applies cleanly.

## Editor rule

Everything injected by the editor at runtime must carry a `data-pml-ui` or `data-pml-runtime` attribute so the server can strip it when saving. The only exceptions are elements that are intentionally persisted to the slide file: `<link data-pml-font>`, `<style data-pml-fx>`, and `<script type="text/pml-notes" data-pml-notes>`.

After editing any file under `src/editor/`, run:

```bash
npm run sync-app
```

This copies the updated editor files into `site/app/` so the browser playground stays in sync.

## Tests

```bash
npm test
```

The test suite uses CDP (Chrome DevTools Protocol) and requires a Chromium-based browser binary on `PATH` (e.g. `brave`, `chromium`, `google-chrome`). Tests live in `tests/`.

## PR guidelines

- Keep PRs small and focused on one change.
- Describe the user-visible change in the PR description — what can someone *do* now that they couldn't before, or what stopped hurting?
- Include screenshots or a short screen recording for any UI change.
- If you're tackling something from the [roadmap](docs/ROADMAP.md), mention the item.
- Run `npm test` before opening the PR.
