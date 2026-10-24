# Small change

**Use for:** a change that touches a few files and needs no design: a config change, a copy change, a small improvement, a quick tooling fix, a handful of small issues together.
**Usually needs:** nothing.
**Produces:** code and tests, a short `spec.md`

## Steps

- [ ] Write a short `spec.md`: what changes, and acceptance criteria. Note new dependencies (usually none).
- [ ] Make the change, with tests.
- [ ] Review in a fresh session: does it meet the criteria, and would the tests catch a regression?
- [ ] Update anything that describes what changed.
- [ ] Close.

If it grows beyond a few files or needs a decision, switch the plan to [feature](feature.md).
