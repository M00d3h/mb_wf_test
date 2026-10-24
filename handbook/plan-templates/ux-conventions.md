# UX conventions

**Use for:** writing or changing what every screen has in common. A child of
writing or changing what every screen has in common. A child of [architecture](architecture.md), or on its own once there's a UI.
**Usually needs:** the requirements. A chosen direction from [visual exploration](visual-exploration.md)
helps.
**Produces:** `docs/ux-conventions.md'

## Steps

- [ ] For each entity, work out which operations users need: list, filter, sort, paginate, create,
edit, delete, undo, bulk actions, export. Don't invent operations for read-only content. Missing
ones go back to the API and data model.
- [ ] Trace each main flow from entry to done: feedback at each step, where it ends, dead ends.
- [ ] Write the conventions: loaded, empty, loading and error states; how errors are worded and
where they appear; forms and validation timing; destructive and irreversible actions; feedback for
slow work; navigation; the accessibility minimum. Say when to use which pattern, not just what the
patterns are.
- [ ] Review in a fresh session through the frontend, accessibility and user lenses: could someone
build a new screen from this without guessing?
- [ ] Resolve findings. If this changes conventions other work already follows, write an ADR.
- [ ] The engineer approves. Merge to main.
- [ ] Close.
