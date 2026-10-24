# Project standard

**Use for:** writing or changing any project standard that doesn't have its own template: engineering principles, voice and copy, accessibility targets, anything the project adds.
**Usually needs:** the requirements, and whatever the standard constrains.
**Produces:** a document in `docs/`, and an ADR if it changes something other work follows

## Steps

- [ ] Ask the engineer what this standard needs to decide, and what they already believe. Read the requirements, the architecture and any `docs/reference/` guidance on it. Notes in `brief.md`.
- [ ] Write or update the standard. Tie each rule to the requirement or source it comes from. Say what isn't allowed, not only what's preferred.
- [ ] If this changes a standard other work already follows, write an ADR.
- [ ] Review in a fresh session: can someone make decisions from it without guessing? Does it follow from this project's needs, or is it generic? Does it contradict another standard?
- [ ] Resolve findings with the engineer.
- [ ] The engineer approves. Merge to main.
- [ ] If existing code has to change to comply, add build steps here, or create items for it.
- [ ] Close.
