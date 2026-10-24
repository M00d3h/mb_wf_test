# Pull requests

How to write a pull request description. The team agreed this format; use it for every PR.

## Scope

One PR per work item, children included. Target `main`, from the item's branch.
A work item is a directory under `work/` with two files it can't do without: `plan.md`, what's meant to happen, and `log.md`, what did. It has its own branch and pull request; see [branches and pull requests](conventions.md#branches-and-pull-requests).

## Title

The [commit convention](conventions.md#commits), with the item's outcome as the subject:
`feat(0007): short links`. The type follows the kind of work: a feature is `feat`, a fix `fix`, a standard `docs`. Keep it under about 72 characters: it becomes the squash commit's subject on main. The squash body lists the branch's commits, so main keeps the record of each task.

## The sections

The [template](../.github/pull_request_template.md) has them in this order. Fill them in from the work item:

- **Summary:** what the PR does and why, in one or two sentences. Usually the item's goal from `plan.md`.
- **Changes:** the key changes as bullets, grouped by area, from the plan's steps and the log. End with anything reviewers should look at closely: the contract, migrations, config.
- **Related:** the work item folders, ADRs, tickets and discussions. Link to files with full GitHub links to the PR's branch (`https://github.com/<org>/<repo>/blob/<branch>/<path>`): relative links break in PR descriptions.
- **How to test:** numbered steps, each with its expected result. Take the commands from `docs/project-knowledge.md`.
- **Screenshots / recordings:** before and after, for anything users see. Otherwise "None".
- **Notes for reviewers:** ADRs that need approval, the reviews that ran and their verdicts, trade-offs, known limitations, follow-up work, and anything you're unsure about.
- **Checklist:** tick what's true; explain anything left unticked.

Keep it plain Markdown. Don't restate the handbook or paste whole logs; link to them.

## With an agent

The agent (`/start-item` in Claude Code) opens the draft PR with the template filled in as far as the plan allows when it claims the item. To update it later, ask the agent to write the description for the branch the branch touches and fills in the template. In Claude Code, `gh pr edit <number> --body-file <file>` updates an open PR; `gh` must be logged in to an account that can see the repository.
