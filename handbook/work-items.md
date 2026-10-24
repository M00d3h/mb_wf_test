# Work items

A work item is a directory under `work/` with two files it can't do without: `plan.md`, what's meant to happen, and `log.md`, what did. It has its own branch and pull request; see [branches and pull requests](conventions.md#branches-and-pull-requests).

## Starting one

Anyone can start a work item at any point. There's no fixed order: if something it needs is missing, the agent says so and the engineer decides what to do about it.

1. **Say what it is.** The engineer describes the work, and gives any files they have for it.
2. **Suggest a template.** The agent says what kind of work this looks like and which [plan template](plan-templates/README.md) fits, in a line. If none fits, it says which is closest, and suggests adding a template if this kind of work will come up again. If the work is big, or parts of it could run in parallel, it suggests making it a [parent](#parents-and-children).
3. **Check what it needs.** Each template has a *Usually needs* line. If something's missing, such as requirements before a feature, the agent says so and offers to start that item first. The engineer can instead give it enough to get going: that goes into `inputs/`, and the plan's Inputs section says it stands in for the missing work.
4. **Propose the plan.** The agent reads the repository and the inputs, asks what it needs to know, and proposes the steps. The engineer adds, drops, rewrites and reorders them.
5. **Claim it.** Take a four-digit number no other item uses: one more than the highest in `work/` on main and on every remote branch, and in every remote branch name. With a slug naming the outcome (`0007-short-links`), branch `feature/NNNN-slug` from main, copy `handbook/scaffolds/work-item/` to `work/NNNN-slug/`, and write the agreed plan. Commit, push and

open a draft pull request before any other work: that's what claims the number. Fill in its description as far as the plan allows ([pull requests](pull-requests.md)). If the branch is already on the remote, someone took the number first: take the next one. An item in state 'scoping' keeps its number and directory; if its branch is already on the remote, someone has picked it up, so stop and say so.

The agent stops after suggesting the template and again after proposing the plan, and waits for the engineer to agree before going on.

## Choosing what's next

When the engineer asks what to work on next, look at which project standards are written and which are still stubs (product brief, requirements, the architecture files, UX conventions, project knowledge), the items on main and in open pull requests, open findings, `work/backlog/` and `work/issues/`, and the regular work in `CONTRIBUTING.md` against the last report of each kind in `work/audits/`. Suggest three to five work items, each with a template and what it depends on, and say which can run in parallel. Missing standards and overdue regular work come first, but the engineer decides the order. Suggesting changes nothing in the repository.

## The plan

`plan.md` says what the item is for and what happens next. It holds the goal, the inputs, the steps, any children, and a `#Next+` line. Nothing else: the method's rules live in `handbook/`, not in every plan.

Steps are a checklist:

- `- [ ]` to do
- `- [x]` done
- `- [ ] (doing: <name>)` in progress
- `- [-] skipped: <reason>`
- `- [ ] (blocked: <what on>)`

Change the steps whenever the work needs it. If you add or drop a step after the plan was agreed, add a line to the log saying why.

## The log

`log.md` is the record of what actually happened. Every item has one, and it isn't optional: the plan says what's meant to happen, the log says what did.

- **One entry per step, written when the step ends.** Not batched up, and never at the end of the item.
- **Each entry says what changed and where**, who did it (the agent and model, or a person), the pull request carrying it, and anything decided, surprising or deferred. The pull request number is what lands in the squash commit on main, so the log and the history join on it.
- **Short.** A few lines, rarely more than ten. Detail belongs in the file the step produced (the spec, a review, a brief), and the entry points to it.
- **Also log:** plan changes after it was agreed, and why; the engineer's approvals; what happened to each review finding; where unfinished work went.
- **Append only.** Never edit or delete an earlier entry. If one was wrong, add a new one saying so.

...

### 2026-10-02 · spec written · agent, Claude (with Sam) · #14

spec.md: 7 acceptance criteria, R-2.1 to R-2.4 covered. Sam decided expired links return
410, not 404; that's AC-5. Bulk import deferred to work/backlog/0007-bulk-import.md.

## Inputs

Files the engineer provides for an item go in its `inputs/` folder, exactly as received: a
prototype, a brief, another team's spec, notes from a meeting. List them in the plan's Inputs
section, and say which steps use them if it matters.

- **Use inputs in the step that needs them.** "I've dropped these two files in, use them for the next
  step" means exactly that. Don't add steps or items just to process them.
- **Never edit an input.** Once a step has turned an input into the project's own documents, work
  from those documents.
- **Material that many items use**, like organisation guidance or another team's API spec, goes in
  the `docs/reference/` folder instead. Link to it from the plan's Inputs.
- **Something given in conversation** that matters beyond the conversation is saved to `inputs/`
  first.

## Other files

- `spec.md`: items that change code. What it must do, with numbered acceptance criteria and the task list.
- `dependencies.md`: items that change code. "None", or the case for each new dependency.
- `reviews/`: one file per review run.
- `brief.md`: notes from interviewing the engineer, when a step starts with questions.
- `scope.md`: what a parent or a planning item covers and what it doesn't.
- `qa-plan.md`: risk scenarios, worst first.
- `manual-test-guide.md`: what a person tries by hand, with the expected result, and what they found.

Produce whatever else the work needs. The only fixed things are names other documents rely on: acceptance criteria (`AC-3`), requirement ids, ADR numbers, finding ids (`F-2`).

# Parents and children

Make an item a parent when it's too big for one plan, or when parts of it could be owned by different people or run in parallel. The engineer decides; the agent suggests it when it sees one of those. [Epic](plan-templates/epic.md) and [architecture](plan-templates/architecture.md) are parents by default, and any item can become one when it grows.

- **The parent's own steps** are what the children share or what checks them together: scope, shared decisions and approvals before the children start; a review of the whole once they're done. The parent doesn't copy the children's steps.
- **Each child is a full work item**, with its own template, plan, log, spec and reviews. It lives inside the parent's directory as `child-01-slug`, `child-02-slug` and so on, and is started the same way as any item, with its own branch and pull request

same way as any item, with its own branch and pull request
([branches and pull requests](conventions.md#branches-and-pull-requests)). Its plan header carries `Parent: NNNN-slug`.
- **A child's own plan holds its state, owner and dependencies.** Nowhere else, so two people working on two children never edit the same file. The parent's plan lists the children by name, one line each, and says how they fit together:

A parent closes when its children are done or moved: to `work/backlog/`, another item, or a new item, with the log saying where.

## The contract

The *contract* is whatever other work depends on: the project standards, the database schema, APIs, access rules, shared packages, and patterns others copy. Every plan says whether the item changes it, in one line.

If it does, the plan includes steps to update the standard, write an ADR, review the change, and record the approval. **Merge the standard change to main as soon as it's approved**, before the rest of the work continues, so other items build against it straight away. The item then carries on from a new branch with the same name and a new pull request (see [branches and pull requests](conventions.md#branches-and-pull-requests)).

If a contract change turns up in the middle of other work, add those steps to the plan there and then. Don't change the contract quietly inside a build.

Changes to the contract happen one at a time, but work built on top of them can run in parallel.

### ADRs

Write an ADR when a decision changes what other work has to follow, or picks between options someone might later question. A decision that only affects one item goes in its spec or log.

- **Any standard, not only architecture.** Changing the testing strategy gets an ADR too. The standard is rewritten to its new state; the ADR records what changed and why.
- **Numbered in order**, in `docs/decisions/`, from `handbook/scaffolds/adr.md`.
- **Never edited once accepted.** To change a decision, write a new ADR that replaces it and mark the old one as replaced.

## Approvals

The engineer who owns an item reviews every step as it happens. Two points also need an approval recorded in the log: a contract change, before anything builds on it, and the finished item, before it closes. The pull request is approved separately, on GitHub. `CONTRIBUTING.md` says who gives the contract, close and pull request approvals. None of these approvals stands in for another.

## States and ownership

`scoping → planned → doing → done`, `blocked` at any point, and `dropped` for an item nobody will do, with the reason in its log. A dropped item stays where it is like any closed one.

`scoping` means named, not yet planned: a directory, a plan with just the goal, a likely template and, for an epic's child, its `Requirements:` line, and a log whose one entry is its creation. Whoever picks it up keeps its number and directory, plans it, and moves it to `planned`.

One person owns an item. To claim it, put your name in the plan and push straight away, so two people claiming the same item collide in git. Keep the *Next* line current, so anyone can pick the item up from the repository alone.

## Closing

An item can close when:

- Every step is done or skipped with a reason.
- Every review finding is fixed, declined with a reason, or deferred. A finding with no outcome in the log is open, and the engineer decides what happens to it.
- The quality gates hold, including the contract approval if the contract changed.
- For a parent: every child is done, dropped or moved, and the log says where.

To close it, the agent lists each condition as met or unmet, with the evidence. If any is unmet, it stops there. Otherwise it summarises what was delivered, each review's verdict, each finding's outcome and the issues closing will create, and **waits for an explicit approval** from whoever `CONTRIBUTING.md` names. Asking to close isn't approval. Then:

1. Each deferred finding becomes a file in `work/issues/`.
2. A log entry records who approved the close, by name, and the issues created.
3. The plan's state becomes `done`; commit `docs(NNNN): close` and push.
4. The pull request is marked ready. The agent never merges: another developer approves the pull request, then the engineer merges it.

Closed items stay where they are until someone archives them into `work/archive/YYYY/`, usually during backlog triage. Nothing is deleted, not even a dropped item: delete nothing from `work/` except by archiving it.
