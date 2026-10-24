# Process audit

**Use for:** checking that the repository records what actually happened, and that the method fits the work. Weekly.
**Usually needs:** nothing.
**Produces:** `work/audits/YYYY-MM-DD.md`, issues, changes to the method

## Steps

- [ ] Review in a fresh session: **the record.** For items active since the last audit:
- Plans were committed before code, and specs before implementation.
- Log entries were written as the work happened, not all at the end.
- The [quality gates](../principles.md#quality-gates) held. Where a plan dropped one, was that raised with the engineer?
- Steps added or dropped after the plan was agreed have a reason in the log.
- Every finding has an outcome. Every review ran in a fresh session.
- Requirements trace to criteria, and criteria to tests. Read three of those tests.
- The architecture and specs describe the code as it is.
- [ ] Review in a fresh session: **the method.** Across the same plans and logs:
- the same step added by hand to several items that used the same template;
- the same step dropped for the same reason several times;
- the same kind of finding recurring;
- friction in the logs: workarounds, or work that had nowhere natural to go.
- [ ] Write the report: a short summary, findings, repeats from earlier audits, and suggested changes to templates or the method.
- [ ] File issues for the record problems. Make the method changes the team agrees with.
- [ ] Close.
