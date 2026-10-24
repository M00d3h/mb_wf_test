# Fix

**Use for:** a known defect.
**Usually needs:** a way to reproduce it.
**Produces:** a fix, a test that failed before it, a short `spec.md`

## Steps

- [ ] Reproduce it. Write `spec.md`: what's broken, what correct looks like, and the root cause once found.
- [ ] Check whether the same bug exists elsewhere.
- [ ] Write a test that fails, then fix the root cause.
- [ ] Review in a fresh session: is it fixed at the root, and does the test fail without the fix?
- [ ] Update anything that described the wrong behaviour.
- [ ] Close.

If it grows beyond a few files or needs a decision, switch the plan to [feature](feature.md).
