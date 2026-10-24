# Requirements

**Use for:** writing the product's requirements, or reworking them substantially. Small changes
writing the product's requirements, or reworking them substantially. Small changes happen inside the item that needs them.
**Usually needs:** a product brief, or inputs describing the product: an idea document, a
prototype, another team's spec, meeting notes. If there's nothing, the first step asks.
**Produces:** `docs/requirements.md` (see [conventions](../conventions.md#requirements-docsrequirementsmd))

## Steps

- [ ] Read everything given: the brief, the files in `inputs/`, anything in `docs/reference/`. For a
  prototype, run it or read it and list what it does. Then ask the engineer what you still need
  to know: users and roles, what must never happen, scale, compliance, integrations. Notes in
  - [ ] Interview the engineer: language and framework, hosting, database, package manager, test tools, CI, code style, anything the organisation requires, and which of these are decided and which are open. Read any tech-stack guidance in `docs/reference/`. Keep asking until you could explain the setup back to them. Notes in `brief.md`.
- [ ] Draft `docs/requirements.md`.
  - Open with your guess at the kind of product, and size everything to it. A section that doesn't
    apply gets "N/A: <reason>", not padding. Don't invent scaling concerns for a static site.
  - Capture every capability the source describes. A missed requirement doesn't get built.
  - From a prototype, write what it does, not how: the production stack may be entirely different.
  - If the sources have tracker ids, give each requirement that delivers some a `Covers:` line
    ([conventions](../conventions.md#requirements-docsrequirementsmd)).
  - Tag each requirement Stated or Inferred. Where no numbers were given (response times, limits),
    propose defaults tagged Proposed.
  - Use the engineer's names for things.
  - Open questions first, most consequential first, each saying what it blocks.
- [ ] Go through the open questions with the engineer. Write the answers into the requirements.
- [ ] Review in a fresh session: **faithful to the source.** Everything in the inputs is here, or
  listed as out of scope with a reason. Stated tags are really stated. Inferred ones are justified
  or turned into questions. Every N/A is genuine. Nothing asked for was cut. Every tracker id
  resolves, to a 'Covers:' line or to out of scope.
- [ ] Review in a fresh session: **failure and edge cases.** Scenarios cover errors, empty and
  missing data, repeated and concurrent use, not only the happy path. Vague qualities ("fast",
  "secure") are rewritten as something testable.
- [ ] Review in a fresh session: **requirements, not design.** Nothing names a mechanism or
  technology that should be an architecture choice. Nothing could reasonably be built two
  different ways.
- [ ] Review in a fresh session: **product and user.** Would the people using this get their job
  done? Missing flows, permissions, notifications, exports, admin work nobody mentioned. Apply the
  product lens, and accessibility and privacy if they apply.
- [ ] Resolve the findings with the engineer. Rerun any review that came back 'Revise'.
- [ ] The engineer approves the requirements. Merge to main so other work can start on them.
- [ ] Close.

## Notes

- The reviews can run in parallel. Drop the ones that don't apply, and add others: a compliance
  review for regulated data, a review by someone from the business.
- Changing requirements that other work already depends on is a contract change: add an ADR.
