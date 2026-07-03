# Landing site

## What this is for
Public marketing page for pml. Itself structured as a presentation: GSAP horizontal-scroll panels, snap, dot nav, arrow keys. Single self-contained file, no build step.

## Folder contents
| Path | What it holds |
|------|---------------|
| `index.html` | Landing deck: markup, CSS, JS. GSAP + fonts from CDN |
| `app/index.html` | Browser playground: localStorage decks, iframe editor host |
| `app/editor.js\|css` | COPIES of src/editor/* — regenerate with `npm run sync-app` after editor changes |

## Routing table
| Task | Read | Skip | Skill |
|------|------|------|-------|
| Any site change | `index.html` only | src/, examples/ | — |

## Conventions
- Brand tokens match product: `--accent #7c6cff`, `--accent-2 #ff6ec7`, bg `#08080c`, Bricolage Grotesque display / Space Grotesk body / JetBrains Mono code.
- Keep vertical fallback working (`prefers-reduced-motion` + ≤860px) — test both.
- Copy mirrors example deck claims; feature list must stay true to SPEC.
- Preview: open file directly, no server needed.

## Available skills
| Skill | When to use |
|-------|-------------|
| — | none relevant |

## Suggested skills (not yet built)
| Skill name | Trigger |
|------------|---------|
| — | — |
