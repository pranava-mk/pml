# Workspace Map

## Purpose
Build pml: presentations as plain HTML files — local server adds visual editing, comments, live reload. AI-agent-native by design.

## Workspace Inventory
| Workspace | Folder | What lives here |
|-----------|--------|-----------------|
| Product code | `src/`, `bin/` | Server (zero-dep Node), editor runtime, CLI |
| Deck template | `templates/` | Scaffold copied by `pml new` |
| Examples | `examples/` | Demo decks (launch = showcase) |
| Integration | `integration/` | Drop-ins for users' Claude Code / Cursor setups |
| Docs | `docs/` | SPEC + decisions. Read SPEC before touching product code |
| Landing site | `site/` | Self-contained GSAP horizontal-scroll page. No build |

## Naming conventions
- Slides: `NN-slug.html` (NN = sort order)
- Specs: `SPEC_<name>.md`
- Context files: `_context.md` per workspace — read before task
- No build step, no framework, no npm deps. Keep it that way.

## Navigation rules
1. Read this file first.
2. Pick workspace for task.
3. Read that workspace `_context.md`.
4. Cross-workspace task → read all relevant `_context.md`.
5. No reading outside active workspace unless routed.

## Workspaces
See each folder's `_context.md`. Core contract: docs/SPEC_pml.md.

## Run / test
```bash
npm run demo                       # serve example deck on :4321
node bin/pml.js new t && node bin/pml.js serve t   # scaffold test
```
