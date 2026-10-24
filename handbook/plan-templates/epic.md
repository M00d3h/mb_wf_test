# Epic

**Use for:** work too big for one item: a large feature, a batch of fixes, a themed round of backlog items. A parent: its children do the building, and it checks they add up to what was asked for.
**Usually needs:** requirements for what it covers, and an architecture to build on.
**Produces:** child items, each with its own plan

## Steps

- [ ] Add `Due: <YYYY-MM-DD>` to the plan header, and `Epic: <id>` if it delivers a tracker epic.
- [ ] Write `scope.md`: what this covers and what it doesn't. For a batch of known work, the list is the scope. For a tracker epic, it opens with the Epic sections, as the project's writing guide describes, if it has one.
- [ ] If it adds capability the requirements don't have yet, update them, with the requirements reviews that apply.
- [ ] Break it into children, and list them in the plan. Each child is usually a [feature](feature.md), or a [fix](fix.md) or [small change](small-change.md) for a batch. If the architecture has to change, that's the first child, using [architecture change](architecture-change.md), and the others depend on it.
- Cut by requirements and by what makes sense to build, not by tracker features. Group small neighbouring requirements; split a large one. Each child lists every requirement it builds, rules that hold everywhere included, in a `Requirements:` line in its plan header, the only record of that link.
- Children can be created in `scoping`, with a log whose one entry is their creation. Mark dependencies "pending the architecture" where it isn't written yet.
- Prefer slices that end in something you can demonstrate over layers only the next child can use.

- [ ] Break it into children, and list them in the plan. Each child is usually a [feature](feature.md), or a [fix](fix.md) or [small change](small-change.md) for a batch. If the architecture has to change, that's the first child, using [architecture change](architecture-change.md), and the others depend on it.
- Cut by requirements and by what makes sense to build, not by tracker features. Group small neighbouring requirements; split a large one. Each child lists every requirement it builds, rules that hold everywhere included, in a 'Requirements:' line in its plan header, the only record of that link.
- Children can be created in 'scoping', with a log whose one entry is their creation. Mark dependencies "pending the architecture" where it isn't written yet.
- Prefer slices that end in something you can demonstrate over layers only the next child can use.
- Each child's scope fits in one sentence without "and also".
- Dependencies only where a child genuinely can't start without another. Say honestly how many can run at once; "one at a time" is a fine answer.
- [ ] Review in a fresh session: **coverage and order.** Every requirement and scope item is delivered by at least one child, and a requirement split across children is covered by them together. Nothing missing, including non-functional requirements. Dependencies are real, none are missing, and the critical path is clear.
- [ ] The engineer approves the children.
- [ ] Children run their own plans.
- [ ] Review in a fresh session: **the whole.** Does what the children built together deliver the scope? Do the pieces fit: consistent behaviour, no duplicated logic between children, nothing left between them?
- [ ] Write a short manual test guide for the whole flow, if users see it. The engineer runs it.
- [ ] Move unfinished children to the backlog or another item, and say where in the log.
- [ ] Close.
