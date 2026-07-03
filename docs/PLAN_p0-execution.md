# pml — Product Roadmap & OSS Launch Plan

## Context

pml (presentation markup language) is feature-complete as a demo: local zero-dep server (deck hub, visual editor, comments, presenter, export), browser playground at `/app/`, AI drop-ins, landing deck at presentations-markup-language.vercel.app. User wants: (1) PM-level assessment — what to add/improve/cut to make it a *complete* product, Canva-grade intuitive; (2) OSS-readiness; (3) a pitch/launch playbook for LinkedIn/GitHub/Twitter/HN. This plan is both the strategy document (to be committed as `docs/ROADMAP.md`) and the implementation slice to execute now.

Already applied pre-plan (uncommitted): `LICENSE` (MIT — was missing, legal blocker), live links in README.

Key finding: **`pml` is taken on npm** (dead Polymer loader, last touched 2022). Options: `pmlkit`, `presentation-markup-language`, or scoped `@pranava-mk/pml`. CLI binary can stay `pml` regardless.

---

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

## Decisions (user-confirmed)
- npm name: **pmlkit**, bin stays `pml` → `npx pmlkit serve`
- Scope: **full P0 slice this session**

## Part 4 — Implementation slice (this session)

P0 build order (each verified via existing CDP test pattern, then committed):
1. **Drag-to-reorder slides** on overview (HTML5 drag on cards → server `POST /api/slide {action:'reorder', order:[...]}` renames prefixes atomically; playground reorders array). Files: `src/server/index.js`, overview page JS, `site/app/index.html`.
2. **Autosave** in editor (debounced 1.5s after dirty; keep Ctrl+S; status dot already exists). File: `src/editor/editor.js` (+ `npm run sync-app`).
3. **Speaker notes + presenter view**: notes textarea panel in editor → `<script type="text/pml-notes" data-pml-notes>` in slide; `/present` gains presenter window (`?presenter=1`: current+next+notes+timer, synced via localStorage key or BroadcastChannel). Files: server present page, editor.js.
4. **PDF export**: `GET {base}/print` — all slides inlined stacked with `@page size: 1280px 720px; margin:0`, auto-open print dialog; button on overview. File: `src/server/index.js` (+ playground equivalent).
5. **Slide layout picker**: replace blank "+ New slide" with modal of 6 layout previews (server + playground share layout HTML strings).
6. **Tests → `tests/`** (port verify.mjs/verify2.mjs, param ports) + `npm test` + GitHub Action.
7. **OSS files**: CONTRIBUTING.md, `.github/ISSUE_TEMPLATE/`, CHANGELOG.md, repo description/topics via web (user) — plus commit ROADMAP.md (Parts 1–3 of this plan).
8. **npm publish prep**: rename package to chosen name (bin stays `pml`), `files` field, publish dry-run (actual `npm publish` needs user's npm login — will hand off).

Deferred to next sessions: theme switcher UI, insert rail + shapes/icons, text-range styling, multi-select, onboarding coach marks, charts, MCP server, share links.

## Verification
- Extend CDP suite: reorder round-trip (order persisted on disk), autosave fires without Ctrl+S, notes persist + presenter window shows them, /print returns N pages, layout picker creates non-blank slide.
- Full existing 22+17 checks re-run.
- `npm test` green locally; Action green on push.

---

## Execution status (2026-07-03, session 6d933bf9)

DONE:
- LICENSE (MIT), README live links, docs/ROADMAP.md
- Server: LAYOUTS constant + slideFromLayout, /api/slide reorder action (two-phase rename), /print route + printPage, /presenter route added (function NOT yet written — server currently broken until presenterPage exists)

IN FLIGHT (delegated to subagents):
- S1 server: presenterPage + BroadcastChannel sync in presentPage + overview UI (drag reorder, layout picker modal, ⎙ PDF button)
- S2 editor: autosave (debounced 1600ms silent) + speaker notes panel (script[type="text/pml-notes"], JSON-encoded, persisted)
- S3 OSS: CONTRIBUTING.md, .github/ISSUE_TEMPLATE, CHANGELOG.md, package.json → name pmlkit v0.2.0 + files field, publish dry-run
- S4 playground: parity (reorder, layout picker, notes bridge passthrough is automatic, run sync-app)
- S5 tests: port tmp verify scripts → tests/, npm test, GitHub Action
- Final: full CDP verify, commit, push (main session)

Conventions for continuation: editor injections tagged data-pml-ui/-runtime (stripped on save) EXCEPT data-pml-font links, style[data-pml-fx], script[type="text/pml-notes"]. Server writes via writeOwn(). Editor copies synced to site/app via `npm run sync-app`. Test pattern: headless brave CDP, see docs + tmp/verify*.mjs.
