# Using lmth inside your AI setup

lmth needs no plugin, no MCP server, no API. Decks are plain files — your agent
edits them, the lmth server live-reloads the browser. These drop-ins just teach
your agent the conventions.

## Claude Code

Copy the skill into your project (or user) skills:

```bash
# project-level
cp -r integration/claude/skills/lmth-slides .claude/skills/lmth-slides
# or user-level (all projects)
cp -r integration/claude/skills/lmth-slides ~/.claude/skills/lmth-slides
```

Then just prompt: *"create a 5-slide pitch deck about X in ./pitch"* —
run `lmth serve pitch` in another terminal and watch slides appear live.

## Cursor / Windsurf / other agents

Append `integration/AGENTS.md` to your project's `AGENTS.md`,
`.cursor/rules/lmth.md`, or equivalent rules file.

## The loop

```
you (browser)  ── drag, restyle, comment, Ctrl+S ──▶  slides/*.html
agent (chat)   ── reads comments.json, edits HTML ──▶  slides/*.html
lmth serve      ── watches files ──▶ browser reloads live
```

Both sides work on the same files. Git is your history, review, and sharing
layer — send someone the folder and they can open any slide with zero tooling.
