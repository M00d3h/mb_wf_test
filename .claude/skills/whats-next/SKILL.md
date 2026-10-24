---
name: whats-next
description: Suggest the next work items for this project. Use when the engineer asks what to work on next, what's m
---

Follow [choosing what's next](handbook/work-items.md#choosing-whats-next). Run `git fetch` first, and list in-flight items from the branches of open pull requests (`gh pr list --state open`).

This is a suggestion only; it changes nothing in the repository. The engineer picks the order, then starts an item with `/start-item`.

Without Claude Code the method works the same: tell the agent "start a work item for X following handbook/work-items.md", and run reviews by opening a brand-new session and pasting "review work item 0007, focus security, following handbook/reviews.md".
