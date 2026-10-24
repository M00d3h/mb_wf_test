# Dependency audit

**Use for:** checking installed dependencies against the dependency policy. Monthly, or when an advisory lands.
**Usually needs:** a dependency policy.
**Produces:** `work/audits/YYYY-MM-DD-dependencies.md`, and updates

## Steps

- [ ] List advisories, outdated versions, unmaintained, unused and duplicate packages. Look versions up live. Gather any open Dependabot or Renovate pull requests.
- [ ] Sort into safe updates (patch and minor, nothing flagged) and ones that need thought (major versions, replacements).
- [ ] Apply the safe updates and run the fast checks.
- [ ] Create items for the rest: a [fix](fix.md) for each serious one, an [epic](epic.md) for a batch.
- [ ] Review in a fresh session: nothing updated breaks the policy, and the checks really passed.
- [ ] Close.



checking that the repository records what actually happened, and that the method fits the work. Weekly.
- [ ] Review in a fresh session through that lens only. Stay in its lane. Three findings that matter beat fifteen trivial ones. Check against 'work/backlog/' and 'work/issues/' so nothing is filed twice.
- [ ] The engineez decides which become work items. Small fixes can be added to this plan instead.
**Produces:** 'work/audits/YYYY-MM-DD-dependencies.md', and updates
