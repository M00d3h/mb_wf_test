# Contributing

<!-- Fill in the angle-bracket parts, then delete this comment. -->

<Project name> is <one or two sentences: what it is, who uses it, who owns it>.

It is built by engineers working with AI agents, using the method in [`handbook/`](handbook/).
Read [`handbook/README.md`](handbook/README.md) and [`handbook/principles.md`](handbook/principles.md)
before starting any work.

The short version: you own everything you commit, including what an agent wrote. All work is a
work item under `work/`, following a plan you shape from a template. Every step produces something
and is logged. Work follows the project's written standards and each item's spec. Keep the
repository cohesive, and improve the method as you go.

What follows is specific to this project.

## Team

- **Developers:** <names>. Each work item has one owner, who builds it with an agent.
- **Principals:** <names>. Accountable for the architecture; they approve ADRs.
- **Product owner:** <name>. Owns the scope of each epic: what's in, what's out, and its priority.

## Project standards

Every work item reads these. If one is wrong, fix it through a work item; don't work around it.
Each starts as a stub naming the plan template that writes it.

- [`docs/product-brief.md`](docs/product-brief.md), [`docs/requirements.md`](docs/requirements.md)
- [`docs/feature-map.md`](docs/feature-map.md), [`docs/release-plan.md`](docs/release-plan.md)
- [`docs/architecture/`](docs/architecture/)
- [`docs/ux-conventions.md`](docs/ux-conventions.md)
- [`docs/project-knowledge.md`](docs/project-knowledge.md)

## Approvals

Three approvals, and none of them stands in for another. See
[approvals](handbook/work-items.md#approvals).

- **Contract approval**, before anything builds on a contract change: <name>.
- **Close approval**, before an item closes: <name>. Only a person runs `/close-item`.
- **Pull request approval**, on GitHub: <names>. Squash merge only, by the engineer who owns the item.

## Regular work

Each one is a normal work item from its template. `/whats-next` compares these cadences against the
last report of each kind in [`work/audits/`](work/audits/README.md) and surfaces overdue ones first.

| Item | Cadence | Template |
| --- | --- | --- |
| Process audit | <e.g. weekly> | [process-audit](handbook/plan-templates/process-audit.md) |
| Lens review | <e.g. fortnightly, least-recent lens first> | [lens-review](handbook/plan-templates/lens-review.md) |
| Backlog triage | <e.g. fortnightly> | [backlog-triage](handbook/plan-templates/backlog-triage.md) |
| Dependency audit | <e.g. monthly, or on an advisory> | [dependency-audit](handbook/plan-templates/dependency-audit.md) |
| UX review | <e.g. after each epic with a UI> | [ux-review](handbook/plan-templates/ux-review.md) |
