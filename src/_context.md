# Product code

## What this is for
Server + editor runtime + CLI (`../bin/pml.js`). Output: `pml` command users run against deck folders. Zero npm deps — Node ≥20 stdlib only.

## Folder contents
| Path | What it holds |
|------|---------------|
| `server/index.js` | HTTP server: routes, SSE live-reload, save/comments API, watcher |
| `editor/editor.js` | Injected runtime: select/edit/drag/toolbar/comments/save |
| `editor/editor.css` | Editor chrome styles (all `.pml-*`, stripped on save) |
| `editor/app.css` | Overview grid + presenter page styles |
| `../bin/pml.js` | CLI: `new`, `serve` |

## Routing table
| Task | Read | Skip | Skill |
|------|------|------|-------|
| API/route change | `server/index.js`, `../docs/SPEC_pml.md` | editor files | — |
| Editor feature | `editor/editor.js` + `editor.css` | app.css | — |
| Overview/present UI | `server/index.js` (page fns) + `editor/app.css` | editor.js | — |
| CLI flag | `../bin/pml.js` | rest | — |

## Conventions
- Everything editor injects tagged `data-pml-ui` or `data-pml-runtime` → stripped by `serialize()` before save. New UI must carry tag or it leaks into saved slides.
- Persisted font links keep `data-pml-font` (NOT stripped).
- Server writes → `writeOwn()` (suppresses watcher echo, 1500ms window).
- Coordinate math: always divide by `scaleFactor()` (slide zoomed to fit).
- Update `../docs/SPEC_pml.md` when routes/contract change.

## Available skills
| Skill | When to use |
|-------|-------------|
| misc:code-cleanup | refactor pass on server/editor |
| misc:code-optimize | perf pass (benchmark before/after — user rule) |

## Suggested skills (not yet built)
| Skill name | Trigger |
|------------|---------|
| pml-e2e-test | recurring manual server smoke tests |
