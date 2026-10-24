# Issues

Problems nobody is currently working on. One file per issue, copied from
[`handbook/scaffolds/issue.md`](../handbook/scaffolds/issue.md) and named after where it came from,
so parallel work items never pick the same name:

- From a review finding: `NNNN-<review>-F-N-<slug>.md`, e.g. `0007-security-1-F-2-open-redirect.md`
- Otherwise: `NNNN-<slug>.md`, where `NNNN` is the work item that raised it

Deferred features go in [`../backlog/`](../backlog/README.md) instead.

This isn't where review findings go. A review during a work item writes its findings into that
item's `reviews/`, and they're resolved there. They only become issues if they're still unresolved
when the item closes. See [`handbook/reviews.md`](../handbook/reviews.md).

Issues arrive when a work item closes with open findings, from audits and lens reviews, or from
anyone who notices something outside what they're working on. Resolved issues move to
`archive/YYYY/` during the next backlog triage.
