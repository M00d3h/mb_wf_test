# Work

Each work item is a directory here, `NNNN-slug/`, with its state in the header of its `plan.md`.
Child items live inside their parent's directory.

- **On main:** items whose pull requests have merged, and `scoping` items waiting to be picked up.
- **In flight:** items on their own branch, each with a draft pull request titled `type(NNNN): outcome`. `gh pr list --state open` lists them.

`/whats-next` reads both. To start an item, see
[`handbook/work-items.md`](../handbook/work-items.md#starting-one).
