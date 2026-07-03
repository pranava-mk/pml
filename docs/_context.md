# Docs

## What this is for
Product contract + decisions. SPEC_lmth.md = source of truth for deck format, routes, editor behavior. Code and integration docs mirror it.

## Folder contents
| Path | What it holds |
|------|---------------|
| `SPEC_lmth.md` | Deck format, server routes, editor features, CLI, non-goals |

## Routing table
| Task | Read | Skip | Skill |
|------|------|------|-------|
| Any contract question | `SPEC_lmth.md` | — | — |

## Conventions
- Contract change flow: SPEC first → code (`src/`) → integration mirrors (`integration/`).
- New decisions: add `SPEC_<topic>.md` or decision log `YYYY-MM-DD_<slug>.md`.

## Available skills
| Skill | When to use |
|-------|-------------|
| misc:docs-generate | generating API docs from server code |

## Suggested skills (not yet built)
| Skill name | Trigger |
|------------|---------|
| — | — |
