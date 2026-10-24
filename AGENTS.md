# Agent instructions

This project uses the method in [`handbook/`](handbook/). Read
[`handbook/principles.md`](handbook/principles.md) first. You work with an engineer who owns everything
you produce and its consequences, and who reviews your work as you go. Make that easy: explain what
you changed and why, point out anything risky or uncertain, and never present work as more finished
or better tested than it is.

## Where things live

**The method**

- `handbook/`: principles, plan templates, conventions, reviews, lenses, and the scaffolds new
  files start from. The team changes these as it learns.

**The project as it is now: `docs/`**

- `docs/product-brief.md`, `docs/requirements.md`: what we're building and what it must do.
- `docs/feature-map.md`, `docs/release-plan.md`: the features, grouped into epics, and which release
  each is built in.
- `docs/architecture/`: the system as it is now: `overview.md`, then data model, API, security,
  deployment, testing strategy and dependency policy.
- `docs/ux-conventions.md`, and any other `docs/<name>.md`: other project standards.
- `docs/decisions/`: ADRs, one decision each.
- `docs/project-knowledge.md`: how to set up, run and test the project, and what trips people up.
  Read it before working.
- `docs/reference/`: outside material that several items use, as received. Never edit it.

- <apps/, 'packages/', ...>: the application; 'docs/project-knowledge.md' says how it's laid out.

**The work: 'work/'**

- 'work/README.md': where to find work items, on main and in open pull requests.
- 'work/NNNN-slug/': a work item. 'plan.md' and 'log.md', plus 'inputs/', 'spec.md', 'reviews/'
  and whatever else it needs.
- 'work/backlog/', 'work/issues/': deferred work, and problems nobody is working on.
- 'work/audits/': reports from audits and lens reviews.

Standards that haven't been written yet exist as stubs saying **Not written yet**. Treat them as
missing: don't build on them, and say so.

## Starting a work item

Follow [starting a work item](handbook/work-items.md#starting-one): suggest a
[plan template](handbook/plan-templates/README.md) in a line and wait for the engineer to agree
before using it. The plan they agree is the plan; commit it, push it and open a draft pull request
before anything else. In Claude Code, '/start-item' runs these steps.

## When asked what to work on next

Follow [choosing what's next](handbook/work-items.md#choosing-whats-next) ('/whats-next' in
Claude Code).

## Writing a PR description

Follow [pull requests](handbook/pull-requests.md): its sections, in order, filled in from the work items and ADRs on the branch.

## Reviewing and closing

Run a review as in [reviews](handbook/reviews.md), in a fresh session or subagent. Close as in [closing](handbook/work-items.md#closing): check every condition, then wait for an explicit approval. Never merge a pull request.

## Skills

Claude Code skills in `.claude/skills/` start the method's procedures. They point into `handbook/`, which stays the single source of truth:

- `/start-item`: start an item from a plan template.
- `/review-item <item> <focus>`: one review in a fresh subagent.
- `/close-item <item>`: check the closing conditions and close. Only a person can run it.
- `/whats-next`: suggest the next work items.

## Rules

1. **Work inside a work item.** If there isn't one for this work, create it first.
2. **The plan is the authority.** Do the step you were asked for. If the work needs a step the plan doesn't have, say so, add it, and log why. Several steps can run in one session when the engineer wants that.
3. **Hold the [quality gates](handbook/principles.md#quality-gates).** If a plan leaves one out, point it out once. The engineer decides.
4. **Use inputs where they're needed.** When the engineer gives you files, save them to the item's `inputs/` unchanged and use them in the current step. Don't create extra steps or items to process them.
5. **Reviews run in a fresh session**, working only from the repository, one review per pass. You can't review work you did. See [reviews](handbook/reviews.md).
6. **Every step changes the repository** and adds one entry to `log.md`: what changed and where. Append only. Commit and push.
7. **Keep what you touched true.** If behaviour changes, update every document that describes it in the same step.
8. **Write decisions down** before the step ends. The next agent won't have this conversation.
9. **No dependency by reflex, and no version from memory.**
10. **Run fast checks, not slow ones.** Unit tests, linting and type checks after each change. For end-to-end or other slow suites, give the engineer the command.
11. **Follow the [conventions](handbook/conventions.md)** for the documents you write.
12. **Use whatever tools help.** If a skill, plugin or other tool fits the step, use it and say which in the log. If it proved useful, suggest adding it to the template.

## Ending a step

Tell the engineer what changed (and the verdict, for a review), what can run next, and which steps are still open.
