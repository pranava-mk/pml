---
name: pml-slides
description: Create and edit pml presentation decks (plain HTML slides with live browser preview). Use when the user asks to make, edit, restyle, or review presentation slides in a pml deck, or mentions pml / HTML slides / deck folders with slides/*.html.
---

# pml slides

pml decks are folders of plain HTML files. A local server (`pml serve <deck>`) gives the user a live browser view with visual editing and comments. **You edit the files; the browser reloads automatically.** Never tell the user to refresh.

## Deck layout

```
mydeck/
  deck.json          # {"title", "author", "transition": "slide"|"fade"|"none"}
  theme.css          # shared styles + font imports + fx preset classes
  slides/
    01-title.html    # one file = one slide, presented in filename sort order
    02-agenda.html
  assets/            # uploaded images — reference as ../assets/<name> from slides
  comments.json      # user feedback pins — READ these, never edit by hand
  .trash/            # soft-deleted slides — ignore
```

## Slide contract (must hold for every slide)

1. Full standalone HTML document — opens in a browser with no server.
2. `<link rel="stylesheet" href="../theme.css">` in head.
3. Body contains exactly one root `<div class="slide">` — a fixed **1280×720** canvas with `position: relative`.
4. No JavaScript in slides. Markup + CSS only.
5. Inline styles are fine for one-off positioning; shared patterns belong in `theme.css`.

## Workflows

**New slide**: copy the structure of an existing slide, keep the numeric filename prefix (`04-pricing.html`), reuse theme classes before inventing new ones.

**Edit slide**: edit the file directly. The user sees changes live at `http://localhost:4321/edit/<file>`.

**Reorder**: rename files (prefix numbers decide order).

**Address feedback**: read `comments.json`. Each comment has `file`, `x`/`y` (percent position on the slide), `author`, `text`, `resolved`. Fix unresolved comments in the referenced slide, then tell the user which comment IDs you addressed so they can resolve them in the browser panel.

**Respect visual edits**: the user may have dragged elements (they become `position: absolute` with inline `left`/`top`) or restyled things inline. Preserve those inline styles unless the user asks you to change them.

## Entrance effects

Decks scaffolded by `pml new` define preset classes in theme.css: `fx-fade-in`, `fx-fade-up`, `fx-zoom-in`, `fx-slide-left`, `fx-slide-right`, `fx-blur-in`. Add the class to any element inside `.slide`; stagger with an inline delay: `style="--fx-delay:0.4s"`. They animate on slide load in presenter/export. If a deck's theme.css lacks them, the browser editor injects an equivalent `<style data-pml-fx>` into the slide — leave that block alone. Use effects sparingly: one or two per slide, staggered.

## Design bar

Slides should look designed, not generated: strong type hierarchy (one big statement per slide), generous whitespace, consistent accent usage from `theme.css` variables, max ~5 bullets. When adding fonts, `@import` them in `theme.css`, or use a `<link data-pml-font>` tag in the slide head.
