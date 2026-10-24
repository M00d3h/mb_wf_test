# Security model

**Use for:** writing or changing the security model. Usually a child of
writing or changing the project's rules for dependencies, and checking the core technologies. Usually a child of [architecture](architecture.md).
**Usually needs:** the architecture overview and the requirements.
**Produces:** `docs/architecture/security.md`

## Steps

- [ ] Ask the engineer about compliance, what data is sensitive, and who the likely attackers are.
- [ ] Interview the engineer: language and framework, hosting, database, package manager, test tools, CI, code style, anything the organisation requires, and which of these are decided and which are open. Read any tech-stack guidance in `docs/reference/`. Keep asking until you could explain the setup back to them. Notes in `brief.md`.
- [ ] Write the model, sized to the product: authentication; authorization and where it's
enforced; sessions; tenancy; input validation and output encoding; secrets; data protection;
audit; what personal data is held, why, and for how long. Prefer rules enforced in code over
rules that rely on convention. With no user accounts, say so and focus on transport, input,
abuse and privacy.
- [ ] List every table or store the model relies on (audit logs, login attempts, consent records),
so the data model can be checked against it.
- [ ] Review in a fresh session through the security and privacy lenses, as an attacker: one tenant
reaching another's data, an id treated as proof of access, error paths that skip checks, anything
unauthenticated with no rate limit.
- [ ] Resolve findings. If this changes a model other work already follows, write an ADR.
- [ ] The engineer approves. Merge to main.
- [ ] Close.

writing or changing how the system is built, released, run and rolled back. Usually a child of [architecture](architecture.md).


1:31
9/10/20
