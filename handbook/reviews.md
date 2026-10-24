# Reviews

A review checks work instead of producing it. Plans mark review steps with *fresh session*.

## Rules

1. **Fresh session.** Start a new session and work only from the repository, never from the conversation that did the work. You can't review work you did.
2. **One review, one focus.** Don't combine reviews into one pass: a review trying to cover security, tests and UX at once misses things, so there's no `code-and-security`. Apply the [lenses](lenses.md) the review is about.
3. **Review, don't fix.** Fixing is a separate step.
4. **End with a verdict:** `Pass` or `Revise`, plus the findings.

## What to read

Read the plan, the spec if there is one, and the plan step that asks for the review, which says what it checks. If the focus is a lens, read it in [`lenses.md`](lenses.md), including its *Never passes* line. Read the standards the focus touches. Then read only what's under review:

- **An item:** its branch's changes, `git diff origin/main...HEAD` after a `git fetch`.
- **A parent, reviewing the whole:** what its children built, plus every child's plan, spec and reviews. This checks how they fit together; it doesn't replace their own reviews.
- **Work already on main**, such as adopted or merged work, isn't in any diff. Review the files the spec names as they are now, and say so in the review.

If the item or focus is ambiguous, or the checked-out branch isn't the item's, stop and say so.

## Where results go

Each review writes `reviews/<focus>-<n>.md` in the work item, for example
`reviews/security-1.md`. A rerun gets the next number, so nothing is overwritten. Use the focus
names the plan templates use, so reviews of the same kind can be found together: `spec-architecture`,
`verify-against-spec`, `risk-scenarios`, `security`, `privacy`, `ux`, `code`, `fit`,
`coverage-and-order`, `whole`, or a lens name. A template's own review (such as requirements'
`faithful-to-the-source`) uses the words in bold in its step.

```markdown
# security-1: 0007-short-links

Verdict: **Revise** (1 medium)

## F-1 · medium · apps/api/src/routes/redirect.ts:41
Destination isn't checked against our own host, so a link can redirect to itself (R-2.5).
Would: reject destinations on the service's own host.

Each finding says what's wrong, where, why it matters, and what you'd do. If a review finds nothing, it says so briefly. The log entry is the verdict, the count by severity and the path to the file; commit both as `docs(NNNN): review <focus>-<cn>`.

## Severity

By consequence, not effort to fix:

- **high:** causes harm or breaks something. A lens's *Never passes* is always high.
- **medium:** wrong in some cases, or makes later work more expensive.
- **low:** worth fixing, with no consequence yet.

Any high finding means `Revise`. Leave out style nits.

## After a review

Deal with each finding: fix it at the root cause, decline it with a reason, or defer it (it moves to `work/issues/` when the item closes). Log what happened to each, e.g. *security-1 F-1 fixed · F-2 deferred*, then rerun the review if anything significant changed.

## Findings and issues

A **finding** is something a review raised inside a work item; it lives in that review's file. An **issue** is a problem nobody is working on; it lives in `work/issues/`. A finding only becomes an issue if it's still open when the item closes.
