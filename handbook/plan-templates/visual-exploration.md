# Visual exploration

**Use for:** exploring what the product, or one screen of it, should look and feel like before it's built. Runs alongside the architecture; it doesn't need it.
**Usually needs:** a product brief or requirements. Any brand or design material in `inputs/`.
**Produces:** throwaway prototypes in `design/`, and the chosen direction written down where builds will read it

## Steps

- [] Ask the engineer what they like, what they don't, and any references. Notes in `brief.md`.
- [] Build two or three directions as plain HTML, CSS and JS in `design/01-<name>/` and so on, each with a one-line summary. They must be genuinely different: if two are the same thing with different colours, merge them. Show loaded, empty, loading and error states. Keyboard-operable, respects reduced motion, placeholder content obviously fake. For a whole product, a few representative pages; for a feature, just that surface.
- [] The engineer gives notes ("drop 2, push 3 further"). Add new numbered directions rather than overwriting. Repeat until the engineer picks one.
- [] Write the chosen direction where builds will read it: into `docs/ux-conventions.md` for the whole product, or the item's spec for one screen. A decision left only in a prototype gets lost.
- [] Close.

## Notes

Don't generate a separate style guide from the prototypes: it would be one more copy to drift.

# Architecture sections


- [ ] if existing code has to change to comply, add build steps here, or create items for it.
- [ ] Close.
- [ ] Ask the engineer what they like, what they don't, and any references. Notes in `brief.md`.
- [ ] Build two or three directions as plain HTML, CSS and JS in `design/01-<name>/` and so on, each with a one-line summary. They must be genuinely different: if two are the same thing with different colours, merge them. Show loaded, empty, loading and error states. Keyboard-operable, respects reduced motion, placeholder content obviously fake. For a whole product, a few representative pages; for a feature, just that surface.
- [ ] The engineer gives notes ("drop 2, push 3 further"). Add new numbered directions rather than overwriting. Repeat until the engineer picks one.
- [ ] Write the chosen direction where builds will read it: into `docs/ux-conventions.md` for the whole product, or the item's spec for one screen. A decision left only in a prototype gets lost.
mode
