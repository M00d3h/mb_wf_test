---
name: start-item
description: Start a work item from a plan template, stopping for the engineer's approval before the template is app
disable-model-invocation: true
argument-hint: "[what the work is, or an item in state scoping]"
---

Start a work item for: $ARGUMENTS

Follow [starting a work item](handbook/work-items.md#starting-one) step by step. The handbook holds
the rules; this skill only makes sure the two stops happen:

1. **Stop** after suggesting the template, and wait until the engineer agrees to one.
2. **Stop** after proposing the plan, and revise it until the engineer says it's agreed.

Done when the plan is pushed and the draft pull request exists. Then tell the engineer the first
step and whether any steps can run in parallel.
