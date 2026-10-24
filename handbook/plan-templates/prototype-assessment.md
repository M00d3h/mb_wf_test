# Prototype assessment

**Use for:** deciding what to keep from a prototype or an existing codebase before building the real thing.

**Usually needs:** the prototype, in `inputs/` or linked. Requirements help but aren't required.

**Produces:** `docs/prototype-assessment.md`

## Steps

- [ ] Run the prototype if possible, and read it. Ask the engineer what it was built for and what they think of it.
- [ ] For each technology and each area of code, decide keep, rebuild or replace, and why. Tell a shortcut taken for speed apart from a bad choice: a library picked for speed that's also right for production stays. Domain logic (rules, algorithms, prompts, validation) is almost always worth keeping. Cite file paths and function names. No estimates or timelines.
- [ ] Note what the prototype does that the requirements don't cover yet, for the requirements item.
- [ ] Review in a fresh session: are the "keep" calls justified, and would anything marked "keep" cause trouble in production?
- [ ] The engineer approves.
- [ ] Close.

Planning


deciding what to work on next when it isn't obvious, and creating the items for it.


work too big for one item: a large feature, a batch of fixes, a themed round of backlog items. A parent: its children do the building, and it…
the notes
