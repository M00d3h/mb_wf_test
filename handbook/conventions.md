# Conventions

Rules for the documents that many work items write to. Whatever step or template is writing one, these apply. Everything else about a document's shape is up to the work.

## Every document

- A document that still says **Not written yet** doesn't exist. Don't build on it; say it's missing.
- An agent must be able to do the work from what's written, and a person must be able to read it. Concise, plain language, no padding, no jargon.

verbatim Co

## Architecture: `docs/architecture/`

- Starts with `overview.md`: the main parts, how they fit together, and the core technologies. Each area has its own file, linked from the overview: `data-model.md`, `api.md`, `security.md`, `deployment.md`, `testing-strategy.md`, `dependency-policy.md`. Add more when an area needs it.
- Describes the system as it is now, never its history.
- Versions are looked up in the registry, never taken from memory.

## ADRs: `docs/decisions/`

See [work items](work-items.md#adrs). Every ADR records the options rejected and what the decision makes harder. An ADR with no rejected options isn't a decision record.

## Other project standards: `docs/`

Testing strategy, security model, deployment, dependency policy, UX conventions, engineering principles, anything the project adds. Each one:

- follows from this project's requirements; generic rules get ignored;
- says what isn't allowed, not only what's preferred;
- doesn't contradict another standard.

## Spec: `work/<item>/spec.md`

- Self-contained: an implementer needs nothing else open.
- Numbered acceptance criteria (`AC-1`). A criterion you can't write a test for isn't one yet.
- Lists the requirements it covers, the rules from the architecture that bind it, what happens when things go wrong, and what's out of scope.
- Ends with the task list: one commit each.
- If the build departs from the spec, the spec is updated in the same commit.

## Dependencies: `work/<item>/dependencies.md`

Either "none", with one line saying why, or for each dependency: why the standard library or a few lines of our own won't do; the version, looked up; alternatives; maintenance health; advisories; licence; and for an upgrade, what its breaking changes touch. Follow the project's dependency policy. Install only what's listed.

## Tests

- At least one test per acceptance criterion, and per high-risk scenario.
- A test must fail if the behaviour it's named for broke. No placeholder or skipped tests.
- Run unit tests, linting and type checks after each change. Don't run slow suites (end-to-end, visual) unless the engineer asks: give them the command.

## Project knowledge: `docs/project-knowledge.md`

How to set up, run, build and test the project, and what trips people up. Link to the architecture rather than repeating it. Delete what's no longer true. `AGENTS.md` holds method rules only.

## Branches and pull requests

- One branch per work item, from `main`: `feature/NNNN-slug`, and `feature/NNNN-child-NN-slug` for a child. A parent's branch carries only the parent's own files: its plan, scope and reviews of the whole.
- One draft pull request per item, children included, opened as soon as the plan is committed, following [pull requests](pull-requests.md) and the [template](../.github/pull_request_template.md).
- Push after every step, so work in flight is visible.
- The plan's `PRs:` line lists the item's pull requests.
- Squash merge only, by the engineer who owns the item.
- A contract change in the middle of an item is merged as soon as it's approved. The branch is then recreated from `main` with the same name, and the new draft pull request is added to `PRs:`.
- Changes to `handbook/` go in their own pull request, never inside a work item's. Before merging any pull request, check its diff touches only what its description says; a rebase or conflict resolution can quietly undo someone else's change.

## Commits

Conventional Commits, with the work item as the scope:

- Work item: `type(NNNN): subject`, e.g. `feat(0007): add redirect handler`
- Child item: `type(NNNN/child-NN): subject`, e.g.
`feat(0003/child-04): validate /health against the contract`
- Method records: `docs(NNNN): plan`, `docs(NNNN): review security-1`, `docs(NNNN): close`
- No work item (method or repo changes): `type(area): subject`, e.g. `docs(handbook): -`
- Types: `feat`, `fix`, `refactor`, `test`, `docs`, `chore`, `ci`, `build`
- Subject: imperative, lower case, no full stop

One commit per task.
