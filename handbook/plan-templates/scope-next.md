# Scope the next round

**Use for:** deciding what to work on next when it isn't obvious, and creating the items for it.
**Usually needs:** nothing. Reads the backlog, issues, recent reviews and audits.
**Produces:** `scope.md` and new work items in state `scoping`

## Steps

- [ ] Ask the engineer what they want from the next round. Their answer leads; the backlog fills in around it. Notes in `brief.md`.
- [ ] Read `work/backlog/`, `work/issues/`, open findings, the last audits, and the items on main and in open pull requests. Check against the code whether any are already done.
- [ ] Write `scope.md`: a few options, each with what it delivers, what it depends on, which open questions it needs answered, and a rough size. Cite the backlog or issue each part comes from. Don't inflate: if eight things form a coherent round, recommend eight. The engineer decides.
- [ ] Create a work item for each chosen piece: a directory, a plan with just the goal and a likely template, state `scoping`. They're planned properly, keeping their number, when someone picks one up.
- [ ] Close.


work too big for one item: a large feature, a batch of fixes, a themed round of backlog items. A parent: its children do the building, and it...


keeping `work/backlog/` and `work/issues/` useful. Every couple of weeks, or when they feel noisy.
