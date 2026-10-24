# Principles

Five principles, the ownership they rest on, and a short list of quality gates. They hold whatever the plan says. Everything else in the method is a default: change it when it gets in the way.

## The engineer owns the result

Everything an agent produces is the engineer's work: the code, the tests, the documents, and what happens when they run in production. The principles below help get it right and go faster. They don't share the responsibility. "The agent wrote it" and "the review passed" are never an excuse.

- Read and understand what goes in. If you can't explain a change, it isn't ready.
- A passing review is evidence, not a sign-off. The engineer's approval is the sign-off.
- If something goes wrong later, it's the engineer's to fix, the same as code they typed.

## 1. Everything is a work item

- Nothing changes the repository outside a work item, including reviews and audits. If there's no item for what you're about to do, create it first.
- An item is a directory with a plan and a log. Large items are split into child items.
- An item exists once its directory and plan exist, on main or in a draft pull request.

**Why:** work outside an item has no plan, no record and no review, so nobody can tell later what was done or why. Draft pull requests show everyone what's in flight, so people can work in parallel without colliding. This is the rule most often broken, usually by a quick fix pushed straight to main.

## 2. Every item follows a plan the engineer owns

- The plan starts from a [plan template](plan-templates/README.md). The agent proposes it from the
  template, the repository and what the engineer has said; the engineer adds, drops, rewrites and
  reorders steps until it describes the work they want done.
- The plan, not the template, decides what happens next.
- The plan changes whenever the work does. When you add or drop a step after it was agreed, say
  why in the log.

**Why:** agents are fast and skip the careful parts unless they're written down. A template puts
risk analysis, security and review in front of you so nobody has to remember them. The engineer
owns the plan because they know the work, and a plan that doesn't fit gets ignored.

## 3. Every step produces something and is recorded

- Every step changes the repository: code, a new file, or an update to an existing one.
- Every step adds a log entry saying what changed and where. Never rewrite an earlier entry.
- A decision made in conversation goes into the document it affects before the step ends.

**Why:** the next person, or the next agent, has only the repository. A conversation is gone when
the session ends, and a record written after the fact sounds plausible but describes decisions
nobody made.

## 4. Work follows written standards

- **The project** has living documents in the repository: the product brief, requirements,
  architecture, the other standards, and ADRs. They describe the system as it is now, and agents

read them before working.
- **Each work item** has a spec, or its equivalent for non-code work, written before the build. It fixes the scope, what's being built and how, and points to the project documents it follows.
- Changing a project document that other work depends on is an explicit, approved change, with an ADR.

**Why:** an agent builds from what it can read. If the standards are only in people's heads, each item makes its own choices and the product drifts apart. A spec fixes the target before anything is built, so the build and its review check against the same thing.

## 5. Keep it cohesive, and keep improving

- **Cohesion.** When a step changes behaviour, it updates every document that describes that behaviour, in the same step. Reviews, lens reviews and audits check over time that code, documents and standards still agree, and that nothing is duplicated.
- **Improvement.** When something proves useful or gets in the way, change the plan templates, conventions or agent instructions, so the next item is faster and better.

**Why:** agents produce a lot quickly, and a repository drifts just as quickly. A document that no longer matches the code is worse than none, because people and agents still believe it. The method lives in the repository too, so improving it is the same work: keeping what's written true and useful.

## Quality gates

These don't depend on the plan. If a plan leaves one out, the agent says so, once. The engineer decides.

- **The engineer vouches for every change.** Nothing merges until the engineer has read it, understands it and stands behind it.
- **Plan and spec before code.** Both are committed before implementation starts.
- **Nothing closes unreviewed.** Every item that changes code or a project standard has at least one review in a fresh session. For code, one review checks it against the spec's acceptance criteria. A close approval is recorded in the log before the item closes.
- **Contract changes come first.** A change to anything other work depends on gets an ADR and a recorded approval, and is merged to main before anything builds on it. See [work items](work-items.md#the-contract).
- **No dependency by reflex.** Every new dependency has a written case and a version looked up in the registry, never taken from memory.
- **Findings don't vanish.** Every review finding is fixed, declined with a reason, or moved to `work/issues/` when the item closes.
