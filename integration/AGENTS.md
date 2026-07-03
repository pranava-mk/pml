# pml deck conventions (for Cursor rules / AGENTS.md / any coding agent)

This project contains a pml presentation deck: a folder of plain HTML slides
served locally with live reload (`pml serve <deck>`). Edit the files; the
user's browser updates automatically.

Rules:

1. One slide = one standalone HTML file in `slides/`, presented in filename
   sort order (`01-…`, `02-…`). Full document, no server required to open it.
2. Every slide links `../theme.css` and has one root `<div class="slide">`
   sized 1280×720 with `position: relative`. No JavaScript inside slides.
3. Shared styling lives in `theme.css`; one-off positioning may be inline.
4. `comments.json` holds reviewer feedback pins (`file`, `x`/`y` percent
   coords, `text`, `resolved`). Read it to address feedback. Never edit it.
5. The user edits visually in the browser too — dragged elements gain inline
   `position:absolute; left; top`. Preserve inline styles unless asked.
6. Reorder slides by renaming the numeric prefix.
7. Design bar: one big statement per slide, strong hierarchy, ≤5 bullets,
   use theme CSS variables for color.
