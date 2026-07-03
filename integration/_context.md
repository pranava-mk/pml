# Integration

## What this is for
Drop-in files users copy into THEIR AI setups (Claude Code, Cursor, any agent) so their agent knows pml deck conventions. No code — pure convention docs.

## Folder contents
| Path | What it holds |
|------|---------------|
| `claude/skills/pml-slides/SKILL.md` | Claude Code skill (copy to `.claude/skills/`) |
| `AGENTS.md` | Rules snippet for Cursor / AGENTS.md consumers |
| `README.md` | Install instructions + the edit loop diagram |

## Routing table
| Task | Read | Skip | Skill |
|------|------|------|-------|
| Update conventions | all 3 files + `../docs/SPEC_pml.md` | src/ | — |

## Conventions
- SKILL.md and AGENTS.md must state the SAME contract — change one, change both.
- Contract changes originate in SPEC; these files mirror it.

## Available skills
| Skill | When to use |
|-------|-------------|
| — | none relevant |

## Suggested skills (not yet built)
| Skill name | Trigger |
|------------|---------|
| — | — |
