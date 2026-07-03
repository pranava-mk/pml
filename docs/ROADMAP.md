# pml — Product Roadmap & Launch Plan

North star: replace PPTX with files you own. Visual editing for humans, plain HTML for AI agents, git for everything else.

Live: https://presentations-markup-language.vercel.app · App: /app/

## Part 1 — Product audit (PM view)

### What's strong (keep, lead with it)
- File-native format — the moat. Git diff/review/CI story no SaaS can match.
- Both-hands story: visual editor for humans + plain files for AI agents.
- Zero deps, zero build — contributor-friendly, nothing to rot.
- Three-surface presence: local CLI, hosted playground, landing-as-demo.

### Table-stakes gaps (blockers for "complete product" claim)
1. **Slide reordering by drag** — today = rename numeric prefix. Worst UX gap; Canva-parity dealbreaker.
2. **Autosave** — Canva users never press save. Debounced auto-save + "Saved ✓" indicator (editor already tracks dirty state).
3. **Speaker notes + presenter view** — notes pane in editor (stored as `<script type="text/pml-notes">` in slide head), presenter window w/ notes + next-slide + timer. Presentations tool without notes isn't one.
4. **PDF export** — print stylesheet route (`/print` page: all slides stacked 1280×720, `@page` sized) → browser print-to-PDF. One click, no deps.
5. **Slide layout picker** — "+ New slide" should offer layouts (Title / Section / 2-col / Bullets+Card / Quote / Stats / Blank), not only blank. Templates as HTML strings, per current theme classes.
6. **Text-range styling** — bold/italic/color on *selection within* text, not whole element (use `execCommand` fallback or manual range wrap; element-level stays for everything else).
7. **Alignment actions + multi-select** — align-to-slide (L/C/R/T/M/B) buttons for selected element; shift-click multi-select + group-move. Smart guides already exist.
8. **Copy/paste elements** — Ctrl+C/V within and across slides (serialize outerHTML to a module-level clipboard).

### Canva-inspired UX polish (design-theory pass)
- **Theme switcher in UI** — deck-level palette/font presets (the 3 example themes become one-click themes). Non-technical users must never open CSS.
- **Insert panel, not menu** — left rail with sections: Text / Shapes (rect, circle, line, arrow SVG) / Icons (inline a small curated Lucide set) / Images. Big previews, click-to-add.
- **Onboarding** — 3 coach-mark tooltips on first editor open (double-click to edit · drag to move · Ctrl+S). Dismiss forever in localStorage.
- **Empty states** — every empty grid gets guidance + primary action.
- **Keyboard shortcuts sheet** — `?` opens overlay.
- **Spacing/type audit** — 8px spacing scale everywhere, one type scale, AA contrast check, toolbar grouped w/ separators + overflow behavior at narrow widths.

### What can GO (cut/park)
- `demo:deck` npm script (redundant with hub).
- Comment **replies** UI could hide behind a disclosure (keep API) — reduces panel noise.
- Font list: trim to 6 curated + system (fewer, better).
- Park: realtime co-editing (CRDT), cloud sync, analytics, PPTX import. Say "no roadmap yet" publicly; local comments + git cover collab v1.

### Differentiators (post-launch, P2)
- **Charts**: tiny SVG bar/line/pie generated from an HTML `<table>` in the slide (data stays readable/diffable — very on-brand).
- **MCP server** (`pml mcp`): tools like `list_slides`, `read_comments`, `apply_feedback` — deeper agent integration than file-watching.
- **Shareable links** from playground (lz-string compress deck into URL hash).
- **Deck import** in playground (drag a deck folder / exported file in).
- **Docs site as a pml deck** — dogfooding as marketing.

---

## Part 2 — OSS readiness checklist

| Item | Status | Action |
|---|---|---|
| LICENSE | ✅ just added | commit |
| npm publish | ❌ name taken | publish as **`pmlkit`** (rec.) with `bin: pml` → `npx pmlkit serve` |
| Tests in repo | ❌ live in tmp | port CDP verify scripts → `tests/` + `npm test` |
| CI | ❌ | GitHub Action: syntax checks + server smoke tests (CDP needs browser — use setup-chrome action) |
| README hero GIF | ❌ | 20s recording: prompt agent → slides appear → drag/comment → present |
| CONTRIBUTING.md + issue templates + good-first-issues | ❌ | write; seed ~10 labeled issues from this roadmap |
| Social preview image | ❌ | 1280×640 card (reuse landing hero art) |
| GitHub repo meta | ❌ | description, topics (`presentations`, `html`, `claude`, `ai-tools`, `slides`), website link, pin |
| Versioning | ❌ | tag v0.2.0 at launch, CHANGELOG.md |

## Part 3 — Pitch & launch playbook

**One-liner:** "Presentations are just files. pml is the PowerPoint replacement that lives in your repo — visual editing for humans, plain HTML for AI agents."

**Narrative** (the LinkedIn post that started this): AI already writes better slides in HTML than PPTX. The only thing PowerPoint still had was the team workflow — review, comment, iterate. pml is that workflow, on files you own.

**Audience → channel → angle:**
1. Devs who present → **Show HN** ("Show HN: pml — presentations as plain HTML files") — lead with zero-dep, git-native, presenter mode; HN loves no-framework.
2. AI-tooling crowd → **X/Twitter thread** — screen recording of Claude Code building a deck live while browser updates; tag Claude/Cursor communities.
3. Professional/original-debate audience → **LinkedIn** — quote the "why still PPTX?" debate, answer with the product; playground link so nobody installs anything.
4. r/SideProject, r/ClaudeAI, r/webdev — playground link first.
5. Product Hunt — only *after* P0 list ships (notes, reorder, autosave), a launch there needs Canva-parity basics.

**Sequence:** P0 features → npm publish → README GIF + social card → tag v0.2.0 → HN Tuesday morning → X thread same day → LinkedIn next day → Reddit through the week. Playground is the top CTA everywhere (zero friction), GitHub second.

**Metrics:** GitHub stars, `npx pmlkit` weekly downloads, playground "deck created" count (add a local-only counter, no tracking — privacy is on-brand), D7 revisit.

---

