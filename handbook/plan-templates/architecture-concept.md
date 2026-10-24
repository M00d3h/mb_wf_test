# Architecture concept section

**Use for:** designing one main concept of the system as its own architecture section, a mini architecture, when none of the standard section templates (data model, API, security and so on) fits. Usually a child of [architecture](architecture.md). For a change to a section that already exists, use [architecture change](architecture-change.md).

**Usually needs:** the approved architecture overview, the requirements, and any design notes, prototype assessment or items other sections handed on.

**Produces:** a `docs/architecture/<concept>.md`, any companion specification or examples builders need, and an ADR for each real choice

## Steps

- [ ] Go through the inputs (design notes, what other sections handed on, the prototype assessment) with the engineer, a part at a time, and settle their open questions. Notes in `brief.md`.
- [ ] List every requirement obligation the concept must meet, each with where the design handles it, in `coverage.md`. Can run alongside the step above.
- [ ] Write `docs/architecture/<concept>.md`: its parts, behaviour and stored format, and its boundaries with other sections. Think past the happy path: missing and invalid data, concurrency, replay, what happens on failure. Requirement gaps or conflicts go to the engineer as amendments, approved and listed in the requirements' amendment note.
- [ ] If a sub-design needs research (a language, a format, an algorithm), research it. The research stays in the item; the specification goes in `docs/architecture/`. Skip if none.
- [ ] If the concept has a stored format, write worked examples in the real format, checked mechanically, in `docs/architecture/`. Skip if none.
- [ ] Write an ADR for each real choice, with the options rejected.
- [ ] Review in fresh sessions, in parallel:
  - **correctness:** behaviour and edge cases a builder would hit;
  - **requirements coverage:** `coverage.md` read against the section, not trusted;
  - **one lens chosen for this concept** when the item is planned, such as "editable without migration" or "every outbound message is tracked".
- [ ] Resolve findings with the engineer, checking each fix against the requirements; rerun reviews that came back `Revise`, unless the engineer says not to.
- [ ] The engineer approves the section, any specification and examples, and the ADRs.
- [ ] Close.

## Notes

- What builders need goes in `docs/`; the research and the decisions behind it stay in the item (`brief.md`, notes, reviews).
- Tick the plan and update its state in the same commit as each log entry.
- First used for the policy engine (0004 child-02 in this repository), and written from it.

Things it adds compared with the other section templates: a `coverage.md` that maps every
