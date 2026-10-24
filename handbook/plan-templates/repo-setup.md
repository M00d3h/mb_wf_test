# Repository setup

**Use for:** getting the repository ready to work in: stack, tooling, CI, local development. Also for larger tooling changes later.

**Usually needs:** a rough idea of the stack. It doesn't have to wait for requirements or architecture: if the team already knows what it's building with, start here. If an architecture exists, follow it.

**Produces:** a working skeleton, `docs/project-knowledge.md`, and ADRs for the choices made

## Steps

- [ ] Interview the engineer: language and framework, hosting, database, package manager, test tools, CI, code style, anything the organisation requires, and which of these are decided and which are open. Read any tech-stack guidance in `docs/reference/`. Keep asking until you could explain the setup back to them. Notes in `brief.md`.
- [ ] Look up the current version of everything proposed in the registry. Never use versions from memory. Flag anything unmaintained or with advisories.
- [ ] Propose the setup in `proposal.md`: tools and versions, folder layout, scripts, CI, how local development works, and what's deliberately left out. The engineer approves or changes it.
- [ ] Write ADRs for the real choices, with the options rejected.
- [ ] Set it up. Done means: it installs and builds from clean; lint, type check and a trivial unit test pass; a trivial end-to-end test passes, if there's a UI; the app runs locally, with its database if it has one; CI runs the fast checks on every push; pre-commit hooks run the fast checks.
- [ ] Write `docs/project-knowledge.md`: how to set up, run, test and build, and which checks are fast and which are slow.
- [ ] Review in a fresh session: clone into a clean directory and follow `docs/project-knowledge.md`

- [ ] Review in a fresh session: clone into a clean directory and follow `docs/project-knowledge.md` exactly. Could a new engineer ship a change today? Anything installed but unused?
- [ ] Close.

## Notes

If the architecture doesn't exist yet, record the choices here as ADRs. The architecture item then builds on them rather than starting from nothing.
