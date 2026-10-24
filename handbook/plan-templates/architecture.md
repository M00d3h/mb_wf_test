# Architecture

**Use for:** designing the system for the first time, or redesigning it wholesale. A parent: the overview is written here, each section is a child, and the checks across sections happen here once the children are done. For a change to an existing architecture, use [architecture change](architecture-change.md).

**Usually needs:** requirements, or at least a product brief. The feature map and release plan if there are any, so the design serves the first release. A prototype assessment if there's a prototype. Any tech-stack guidance in `docs/reference/`.

**Produces:** `docs/architecture/overview.md`, ADRs, and a child item per section

## Steps

- [ ] Ask the engineer what's already decided (stack, hosting, anything the organisation requires) and what's open, and who will work on which sections. Notes in `brief.md`.
- [ ] Write `docs/architecture/overview.md`: the main parts and how they fit together, how data flows, integrations, and the core technologies with an ADR for each real choice. Name services for this domain, not a generic template, with clear boundaries, no cycles between them, and errors handled in one place. The requirements override any default: no database if nothing is stored, no single-page app if the requirements rule it out.
- [ ] Review in a fresh session: **the overview.** Do the core choices follow from the requirements? Is anything over-built for this product? Could the sections be written from this alone?
- [ ] The engineer approves the overview. Merge to main so the sections can start.
- [ ] Create a child for each section the product needs, and say which can run in parallel:
  - [data model](data-model.md), if anything is stored
  - [API](api.md), if there is one
  - [security model](security-model.md)

- [data model](data-model.md), if anything is stored
- [API](api.md), if there is one
- [security model](security-model.md)
- [deployment](deployment.md)
- [testing strategy](testing-strategy.md)
- [dependency policy](dependency-policy.md)
- [UX conventions](ux-conventions.md), if there's a UI

Skip what doesn't apply, with a reason.
- [ ] Children run their own plans.
- [ ] Review in a fresh session: **consistency across sections.** The API matches the data model (names, types, relations). Every log or record the security model describes has storage behind it. Retention and erasure have a real mechanism, not "should". Integrations track what they send. Deployment and testing cover everything the other sections introduced. Fix every file a finding touches.
- [ ] Review in a fresh session: **requirements coverage.** Map every requirement to the section that covers it, reading the section rather than trusting its heading. List gaps and anything ambiguous for the engineer; don't guess. Write the map to `reviews/`.
- [ ] Resolve findings with the engineer; rerun reviews that came back `Revise`.
- [ ] The engineer approves the architecture as a whole. Merge to main.
- [ ] Close.

## Notes

- For a small project, keep it in one item: add the sections' steps to this plan instead of creating children.
- No code in this item. Repository setup is its own item and can run in parallel.
