# Testing strategy

**Use for:** writing or changing what testing means on this project. Usually a child of [architecture](architecture.md).
**Usually needs:** the architecture overview and the requirements.
**Produces:** `docs/architecture/testing-strategy.md`

## Steps

- [ ] Write the strategy, sized to the product: the layers and what each is for, what coverage means and whether it gates, test data and fixtures, how integrations are faked, what CI blocks on, and how flaky tests are handled. A content site leans on end-to-end, visual and accessibility checks; a service leans on unit and integration tests.
- [ ] Say which checks are fast (run after every change) and which are slow (run on request or in CI), with the command for each.
- [ ] Review in a fresh session through the testing lens: would this strategy catch the failures the requirements care about most? Is anything counted as coverage that tests nothing?
- [ ] Resolve findings. If this changes a strategy other work already follows, write an ADR.
- [ ] The engineer approves. Merge to main.
- [ ] Close.
