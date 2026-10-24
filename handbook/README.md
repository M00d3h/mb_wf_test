# The method

How we build software with AI agents.

## What it's for

Agents can deliver far faster than a team working by hand. Left unchecked, they also produce what makes software expensive later: code that works in the demo and breaks under real load, tests that check nothing, and documentation that no longer matches the code. We want the speed without those problems.

Agents make the careful parts cheap: a real spec, thinking through failure, independent review, keeping documents up to date. This method makes sure those parts happen.

## Who does the work

An engineer, working with an agent. The agent does most of the work. The engineer decides what gets done, reviews each step as it happens, and vouches for everything that goes in.

**The engineer owns the result.** The code, the documents, and their consequences in production
ICE Release Plan
18 - FULL TEXT

are theirs, exactly as if they'd written every line. The method helps them get it right faster; it doesn't take any of the responsibility.

Work is also checked by reviews that run in a **fresh session**, working only from the repository. The engineer and the reviews catch different things, so you need both. Pull requests don't get a separate code review.

## How it works

Five [principles](principles.md), resting on the engineer owning the result:

1. Everything is a work item.
2. Every item follows a plan the engineer owns, starting from a template.
3. Every step produces something and is recorded.
4. Work follows written standards: living documents for the project, a spec for each item.
5. Keep it cohesive, and keep improving.

A few **quality gates** hold whatever the plan says. Work can start anywhere: if an item needs something that doesn't exist yet, the agent says so and the engineer decides.

## Tools

The method doesn't prescribe tools. Use whatever gets a step done well: skills, plugins, MCP servers, scripts, other agents, a whiteboard session. The rules don't change: the output lands in the repository, and the engineer owns it.

In Claude Code, the skills in `.claude/skills/` start the method's procedures (`/start-item`,

`/review-item`, `/close-item`, `/whats-next`). They hold no rules of their own: each adds only what a skill can do and the handbook can't (a reviewer with no memory of the conversation, a close only a person can start) and points here for the rest.

## Contents

- [`principles.md`](principles.md): the five principles, with why, and the quality gates. Start here.
- [`work-items.md`](work-items.md): starting an item, the plan, the log, inputs, parents and children, the contract, closing.
- [`plan-templates/`](plan-templates/README.md): starting plans for each kind of work, and how to start a project.
- [`conventions.md`](conventions.md): rules for the documents many items write to, and for branches, pull requests and commits.
- [`reviews.md`](reviews.md): how reviews run and where findings go.
- [`lenses.md`](lenses.md): specialist perspectives for reviews.
- [`pull-requests.md`](pull-requests.md): the format for PR descriptions.
- `scaffolds/`: starting files for plans, logs, specs, dependencies, ADRs, issues and backlog items.

## Terms

- **Work item**: a directory under `work/` holding one piece of work.
- **Plan**: the item's `plan.md`: goal, inputs, steps, children, what's next.
- **Log**: the item's `log.md`: one entry per step, saying what changed and where.
- **Plan template**: a starting list of steps for a kind of work.
- **Inputs**: files provided for an item, kept unchanged in its `inputs/` folder.
- **Fresh session**: a new agent session that works only from the repository.
- **finding / issue**: a finding is something a review raised inside an item. An issue is a problem nobody is working on, in `work/issues/`.
- **Project standards**: the documents every item builds against: product brief, requirements, architecture, testing strategy, security model, deployment, dependency policy, UX conventions, and any others the project adds.
- **Contract**: whatever other work depends on: the standards, the schema, APIs, shared packages.
- **ADR**: a short numbered record of one decision, the options rejected, and why.
- **Lens**: a specialist perspective a review applies, such as security or accessibility.

## Changing the method

The method belongs to the team using it, and improving it is [principle 5](principles.md#5-keep-it-cohesive-and-ke
Change plan templates, conventions, lenses and agent instructions directly, with the reason in the commit message; no work item needed. A change to `handbook/` goes in a pull request of its own, `docs(handbook): _`, never inside a work item's pull request, so it can't be lost or undone in a merge nobody reads for it. Principles and quality gates are the exception: talk to the team first, because they're what makes the output trustworthy.

Keep it simple. Prefer a line in a template over a new rule.
