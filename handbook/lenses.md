# Lenses

A lens is a specialist perspective. Reviews pull in the lenses their change touches, and a [lens review](plan-templates/lens-review.md) applies one lens to the whole codebase. If a project needs a lens that isn't here, add it.

**Security.** Authorization on every path, including error paths; one tenant reaching another's data by guessing an id; input validation and output encoding; secrets in logs or errors; rate limits on anything unauthenticated. *Never passes:* an id treated as proof of access.

**Performance.** Request work that grows with the size of the data, N+1 queries, missing indexes, unbounded collections, slow work done on the request path. *Never passes:* aggregating data in memory when we don't control how big it gets.

**Data.** Constraints enforced in the database, not only in code; migrations that fail partway; time zones; soft deletes combined with uniqueness. *Never passes:* a migration that can't be run twice safely.

**Operability.** How you'd know it's broken, logs that can trace a request, health checks that check something real, behaviour when a dependency is down, rollback. *Never passes:* a failure with no signal.

**Accessibility.** Keyboard access and visible focus, semantic structure, labels, contrast, announcing state changes, reduced motion. *Never passes:* anything that only works with a pointer.

**Frontend and UX.** Loaded, empty, loading and error states; consistency with the conventions; destructive actions; dead ends. *Never passes:* a flow that can strand the user.

verbatim Cop

**Testing.** Whether each test would fail if the behaviour broke; asserting values rather than "didn't throw"; mocks standing in for the thing under test; error paths. *Never passes:* a placeholder test counted as coverage.

esh

**Privacy and compliance.** What personal data we collect and why, retention actually carried out, an audit trail, data leaving the system. *Never passes:* personal data kept with no stated reason or retention period.

t

**Architecture.** Clear boundaries and contracts between parts, errors handled in one consistent way, startup and middleware order, whether a new technology earns its place against what the project needs. *Never passes:* two parts that depend on each other.

**User.** Whether someone who just wants to get their job done would understand it: names, error messages, how many steps things take, whether it feels faster than what it replaces, whether they can trust what it shows them. *Never passes:* an error message that doesn't say what to do next.

its

**Product.** Whether it does what was actually asked for, or only meets the letter of it. *Never passes:* a requirement marked covered when it isn't.

s

**Dependencies.** Unused packages, two doing the same job, one added for something trivial, anything unmaintained, versions or licences the project's dependency policy doesn't allow. *Never passes:* a dependency added with no case made for it.

**Documentation.** Whether the architecture describes the system that actually exists, and whether anything is written as fact that is really only intended. *Never passes:* a document claiming something the code doesn't do.
