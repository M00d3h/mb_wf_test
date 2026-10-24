# Feature

**Use for:** one deliverable that changes code: a feature, a refactor, a substantial change. The default for building.
**Usually needs:** requirements that cover it, and an architecture to build on. Without them, the engineer can describe the feature in `inputs/` and the spec states its assumptions.
**Produces:** code and tests, `spec.md`, `dependencies.md`, reviews

## Steps

- [ ] Write `spec.md` ([conventions](../conventions.md#spec-workitemspecmd)): the requirements it covers, the architecture rules that bind it, numbered acceptance criteria, failure behaviour, what's out of scope, and the task list. Business scenarios and the user story follow the project's writing guide, if it has one. Ask the engineer about anything unclear before writing. Commit it before any code.
- [ ] Write `dependencies.md`: **none**, or the case for each addition with its version looked up.
- [ ] Review in a fresh session: **spec against the architecture.** Does it fit the architecture and standards, and the requirements that hold everywhere, such as how refusals are worded? A departure is fine if the reason is real ("the library can't do X"), not taste ("I prefer Y"); if it's accepted, the standard changes first, as a contract change. Can every criterion be tested? Is each addition in `dependencies.md` justified? More than about twelve tasks suggests splitting.
- [ ] Design the screens, if there are new ones: prototypes in `design/`, the chosen direction written into the spec. See [visual exploration](visual-exploration.md).
- [ ] Risk analysis: read the spec trying to break it. Edge cases, bad input, concurrency, partial failure, retries, volume, a dependency being down. Scenarios in `qa-plan.md`, worst first.
- [ ] Build it, one task per commit, with a log entry for each. A test per criterion and per high-risk scenario. Install only what `dependencies.md` lists. If the build departs from the

- **Small change** 5 steps · 1 fresh-session review

a change that touches a few files and needs no design: a config change, a copy change, a small improvement, a quick tooling fix, a handful of...

- [ ] Risk analysis: read the spec trying to break it. Edge cases, bad input, concurrency, partial failure, retries, volume, a dependency being down. Scenarios in `qa-plan.md`, worst first.
- [ ] Build it, one task per commit, with a log entry for each. A test per criterion and per high-risk scenario. Install only what `dependencies.md` lists. If the build departs from the spec, update the spec in the same commit; if it would change the contract, stop and add those steps to the plan.
- [ ] Review in a fresh session: **verify against the spec.** One entry per criterion. Read the tests, not their names: a test that checks nothing counts as missing. The manifest matches `dependencies.md`.
- [ ] Review in a fresh session: **risk scenarios.** Each one covered by a test, by defensive code, or explicitly accepted. An unhandled serious one fails.
- [ ] Review in a fresh session: **security**, if it adds input, stored data or access rules. Add privacy if personal data is involved.
- [ ] Review in a fresh session: **UX**, if users see it. Against the UX conventions; if the build found a better pattern, update the conventions rather than keep two.
- [ ] Review in a fresh session: **code.** Duplicated logic, swallowed errors, wrong abstractions, misleading names. Skip what the linter enforces.
- [ ] Review in a fresh session: **fit with the codebase.** Where people would expect it, package boundaries respected, nothing rebuilt, nothing rebuilt, no second way of doing something, code shared or not shared in the right place. Dead code and unused exports removed.
- [ ] Fix the findings; rerun reviews that came back `Revise`.
- [ ] Write a short manual test guide for the engineer: five to ten things to try that automated tests can't judge (feel, speed, polish, error paths), unresolved risks first. The engineer records findings in the same file; fix them.
- [ ] Check every document that describes what changed: spec, architecture, standards, requirements, READMEs. Add anything the next person needs to `docs/project-knowledge.md`.
- [ ] Close.


a change that touches a few files and needs no design: a config change, a copy change, a small improvement, a quick tooling fix, a handful
- [ ] Review in a fresh session: **fit with the codebase.** Where people would expect it, package boundaries respected, nothing rebuilt that already exists, no second way of doing something, code shared or not shared in the right place. Dead code and unused exports removed.
