# Plan templates

A plan template is a starting list of steps for a kind of work. When you start a work item, the agent suggests a template, and you and the agent turn it into the item's plan: add steps, drop them, rewrite them, reorder them. After that the plan is what counts, not the template. See [starting a work item](../work-items.md#starting-one).

These templates are starter examples, taken from earlier AI-assisted workflows that have worked in practice. They aren't prescriptive: change them, delete the ones you don't need, and add new ones when something proves useful.

Every step that says **+Close+** means: every step done or skipped, findings dealt with, the close approval in the log, the plan's state `done` and the pull request ready. See [closing](../work-items.md#closing).

## Templates

**Product and standards**

- [Product brief](product-brief.md): what we're building, for whom, and why. Interview first.
- [Requirements](requirements.md): what the product must do, reviewed from several angles.
- [Feature mapping](feature-mapping.md): the requirements as features grouped into epics, and the release plan if there are dates.
- [Architecture](architecture.md): the overview, with a child for each section below, then the checks across them.
- [Architecture change](architecture-change.md): a change to an existing architecture, proposed, reviewed and folded in.
- [Project standard](project-standard.md): writing or changing any other standard.
- [Visual exploration](visual-exploration.md): throwaway prototypes of the look and feel.

**Architecture sections**, usually children of architecture, and used on their own to change one later:

- [Data model](data-model.md)
- [API](api.md)
- [Security model](security-model.md)
- [Deployment](deployment.md)
- [Testing strategy](testing-strategy.md)
- [Dependency policy](dependency-policy.md)
- [UX conventions](ux-conventions.md)

**Starting points**

**Starting points**

- [Repository setup](repo-setup.md): stack, tooling, CI and local development.
- [Prototype assessment](prototype-assessment.md): what to keep from a prototype or existing code.

**Planning**

- [Scope the next round](scope-next.md): what to work on next, and the items for it.
- [Epic](epic.md): work too big for one item, split into children.
- [Backlog triage](backlog-triage.md): keeping the backlog and issues useful, and archiving.

**Parents**

[Epic](epic.md) and [architecture](architecture.md) are parents: their children do the work, and
they check the children add up. Any item can become a parent when it grows. See
[parents and children](../work-items.md#parents-and-children).

**Building**

- [Feature](feature.md): one deliverable that changes code, with the full set of checks.
- [Small change](small-change.md): a few files, no design needed.
- [Fix](fix.md): a known defect.
- [Spike](spike.md): a time-boxed question.

**Health**

- [Lens review](lens-review.md): the whole codebase through one lens.
- [Dependency audit](dependency-audit.md): dependencies against the policy.
- [UX review](ux-review.md): the built product, as someone using it.
- [Process audit](process-audit.md): the record matches reality, and the method fits the work.

If nothing fits, start from the closest and adapt it. If that kind of work will come up again, add a template.

## Starting a project

There's no fixed order. Most projects need most of these, and the agent will point out what's missing when an item depends on it. A common shape:

- **Straight away, in parallel:** a [product brief](product-brief.md) or [requirements](requirements.md) from whatever the project starts from, and [repository setup](repo-setup.md) if the team already knows its stack. Add a [prototype assessment](prototype-assessment.md) if there's a prototype, and [visual exploration](visual-exploration.md) if the look matters early.
- **Once there are requirements:** [feature mapping](feature-mapping.md), so the architecture knows what the first release must do. Then [architecture](architecture.md). Once its overview is approved, its sections are children that different people can take in parallel: security, deployment, the data model, and so on.
- **Before building features:** any other standards the project wants, such as engineering principles, using [project standard](project-standard.md).
- **Then:** [scope the next round](scope-next.md) or an [epic](epic.md), and build.

At any point, ask the agent what to work on next.

## Changing templates

Templates belong to the team. Change them whenever you see a better way: add a step you keep adding by hand, drop one nobody uses, write a new template for a kind of work that keeps coming up. No work item is needed; say what changed and why in the commit message, in a pull request of its own ([changing the method](../README.md#changing-the-method)).

Changing a template doesn't affect plans already made from it.

A template is a markdown file with:

- a title;
- **Use for**, **Usually needs** and **Produces** lines;
- **Steps** as a checklist, each saying what to do in plain words, with anything an agent wouldn't know without being told;
- optional **Notes**.

Mark review steps "Review in a fresh session", and say what the review looks for. A step can name a tool or skill that does the job well.

## Product and standards


a short description of what we're building, for whom, and why, when there isn't one yet. It's what every other item can read before requirements...


writing the product's requirements, or reworking them substantially. Small changes happen inside the item that needs them.
