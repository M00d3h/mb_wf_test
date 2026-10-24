# NNNN: <title>, dependencies

Written after the spec and before it is reviewed. Follow
`docs/architecture/dependency-policy.md`.

## Either

**No new or changed dependencies.** <one line: what already installed covers this work>

## Or, for each

### <package> <version, from a live lookup>: new | upgrade from <version>

- **Case:** what it does; why not the standard library; why not a few lines of our own
- **Alternatives:** what else was considered, and why this one
- **Health:** maintainers, release history, adoption; five-year outlook
- **Security:** advisories against this version
- **Licence:** <licence>. On the allowed list?
- **Breaking changes** *(upgrades)*: what in our code they touch
