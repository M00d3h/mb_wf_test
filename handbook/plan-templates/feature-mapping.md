# Feature mapping

**Use for:** turning approved requirements into features, grouped into epics, and, when there are release dates to plan against, the release plan. Run it after the requirements and before the architecture, so the architecture knows what the first release must do.
**Usually needs:** approved requirements; the product brief, for its release lines and constraints. A prototype helps with sizing, if there is one.
**Produces:** `docs/feature-map.md`; `docs/release-plan.md` if releases are planned; the epics, in `scoping`

## Steps

- [ ] Read the requirements, the brief, and the prototype if there is one.
- [ ] Write `docs/feature-map.md`.
  - A feature is something a person could see working, described by what it does, never how. Give each an id, `FE-n`, so it can't be mistaken for a review finding (`F-n`), and keep ids stable once given: a split keeps the id for one half and gives the other a new number.
  - Each feature has a one-line outcome, the requirement ids it satisfies (marked `(part)` where another feature satisfies the rest), the features it depends on, and the open questions that touch it.
  - Rules that hold for every feature (audit, permissions, accessibility, time handling) go in one "Every feature" list, each naming the feature that first builds the shared part. A small foundation (platform, sign-in, audit recording) comes before everything else.
  - Check with a script that every requirement is in a feature or the "Every feature" list, that the requirements index at the end is derived from the features, and that the dependencies have no cycles.
- [ ] Review in a fresh session: **standalone and grouping.** Can each feature be built as one item


designing the system for the first time, or redesigning it wholesale. A parent: the overview is written here, each section is a child, and the...

and used on its own, or only with others? Features too thin to ship alone, too fat to size, or
hiding parts with different dependencies; dependencies missing, wrong or circular; shared
foundations nobody owns. Propose epics: modules one owner could build, each feature in exactly
one.
- [ ] Review in a fresh session: **platform capabilities.** Capabilities the features rely on that
no feature owns, such as how a run evaluates something or a job that runs with nobody watching.
For each: a missing feature, a requirement on an existing feature, an "Every feature" rule, or
the architecture's to decide. Prefer the smallest change.
- [ ] Resolve both reviews' findings with the engineer, and add the epics to the map: each epic
with its goal, its features, and what it starts after. Epics are modules, not releases.
- [ ] Go through the features and epics with the engineer: merge, split, rename.
- [ ] If releases are planned, write `docs/release-plan.md`, as release → epics → features.
- Ask the engineer for the calibration first: anchors for a few epics, the capacity (how many
builders, counted how), and a buffer. Size each feature against them, in builder-days. Size
porting a known design from a prototype differently from new infrastructure and integrations.
- Order by dependencies, then risk, then value. Give each release its date from the capacity and
buffer, and the order of build with the critical path.
- Say what each release is, what's deliberately not in it, and what could still be cut, with
- Say what each release is, what's deliberately not in it, and what could still be cut, with what each cut saves and costs.
- List the open questions each release needs, with the owner and the feature that needs the
answer.
- Anything the plan moves out of a release that a requirement assumes is in it is a requirement
- Anything the plan moves out of a release that a requirement assumes is in it is a requirement amendment for the engineer to approve.
- [ ] The engineer agrees the plan.
- [ ] Review in a fresh session: **whole and consistent.** Every requirement placed; the map and the plan agree on ids, names, epics and placements; nothing depends on a feature in a later release; totals and dates recompute; every open question a release needs has an owner. The engineer's decisions and estimates are not up for review.
- [ ] Resolve the findings with the engineer. Rerun a short review on what changed if it was more than wording.
- [ ] Contract approval: the engineer approves both documents, and any requirement amendments, recorded in the log. Add them to the project standards in `CONTRIBUTING.md`, and bring the brief's release lines into line.
- [ ] Create one epic per module in `scoping`, its features listed in parts by release. They're planned with the [epic](epic.md) template once the architecture is written.
- [ ] Close.

## Notes

- Without release dates, stop after the feature map and the epics; the release plan can be its own item later.
- An agent's own sizing tends to run high for work that ports a known design. Take the engineer's anchors, and test the estimates against the first features actually built.
