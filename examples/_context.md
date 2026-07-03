# Examples

## What this is for
Demo decks. `launch/` = product showcase — must look fabulous, doubles as manual test fixture for server/editor.

## Folder contents
| Path | What it holds |
|------|---------------|
| `launch/slides/*.html` | 6 slides pitching pml |
| `launch/theme.css` | Template theme + launch extras (codeblock, vs, grid-3) |
| `launch/deck.json` | Title/author |

## Routing table
| Task | Read | Skip | Skill |
|------|------|------|-------|
| Edit demo content | target slide + `theme.css` | src/ | — |
| New demo deck | `../templates/deck/` as base | launch/ | — |

## Conventions
Slide contract from `../docs/SPEC_pml.md` is law: standalone doc, `../theme.css` link, one `.slide` root 1280×720 `position:relative`, no JS.

## Available skills
| Skill | When to use |
|-------|-------------|
| — | none relevant |

## Suggested skills (not yet built)
| Skill name | Trigger |
|------------|---------|
| new-deck | scaffolding themed demo decks becomes recurring |
