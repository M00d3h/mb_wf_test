#!/usr/bin/env bash
# Lay out a fresh repository for the Work Item Method.
# Run from the root of the new, empty repository:
#   bash bootstrap.sh /path/to/a/repo/that/already/has/handbook
# The handbook, .claude/skills and the PR template are copied from that repo;
# everything else is created here as stubs.
set -euo pipefail
SRC="${1:?give the path of a repo that already uses the method}"

# 1. The method itself: copied, then owned by this team.
cp -r "$SRC/handbook" handbook
mkdir -p .claude .github
cp -r "$SRC/.claude/skills" .claude/skills
cp "$SRC/.github/pull_request_template.md" .github/

# 2. The work area.
mkdir -p work/backlog work/issues work/audits
cp "$SRC/work/README.md"          work/README.md
cp "$SRC/work/backlog/README.md"  work/backlog/README.md
cp "$SRC/work/issues/README.md"   work/issues/README.md
cp "$SRC/work/audits/README.md"   work/audits/README.md

# 3. Project standards: every one starts as a "Not written yet" stub naming its template.
mkdir -p docs/architecture docs/decisions docs/reference
stub() { # stub <file> <Title> <template-file> <one line on what it holds> <depth to repo root>
  printf '# %s\n\n> **Not written yet.** Start a work item from the\n> [%s](%shandbook/plan-templates/%s) template to write it, and replace this whole file.\n\n%s\n' \
    "$2" "${3%.md}" "$5" "$3" "$4" > "$1"
}

stub docs/product-brief.md          "Product brief"         product-brief.md        "What we're building, for whom, and why." "../"
stub docs/requirements.md           "Requirements"          requirements.md         "What the product must do, as Given/When/Then." "../"
stub docs/feature-map.md            "Feature map"           feature-mapping.md      "The features, grouped into epics, each mapped to a requirement." "../"
stub docs/release-plan.md           "Release plan"          feature-mapping.md      "Which features are built in which release." "../"
stub docs/ux-conventions.md         "UX conventions"        ux-conventions.md       "What every screen has in common." "../"
stub docs/project-knowledge.md      "Project knowledge"     repo-setup.md           "How to set up, run, build and test the project, and what trips people up." "../"
stub docs/architecture/overview.md  "Architecture overview" architecture.md         "The main parts, how they fit together, and the core technologies." "../../"
stub docs/architecture/data-model.md "Data model"           data-model.md           "Entities, relations, constraints and stored formats." "../../"
stub docs/architecture/api.md       "API"                   api.md                  "Every operation: who can call it, what it takes, what it returns, and how it fails." "../../"
stub docs/architecture/security.md  "Security model"        security-model.md       "Authentication, authorization, secrets and data protection." "../../"
stub docs/architecture/deployment.md "Deployment"           deployment.md           "Environments, releases, configuration and rollback." "../../"
stub docs/architecture/testing-strategy.md "Testing strategy" testing-strategy.md   "Test layers, what CI blocks on, and what a reviewer should expect." "../../"
stub docs/architecture/dependency-policy.md "Dependency policy" dependency-policy.md "What a new dependency must show before it's allowed." "../../"

echo "Now write AGENTS.md, CLAUDE.md, CONTRIBUTING.md, docs/decisions/README.md and"
echo "docs/reference/README.md from the guide, then commit:"
echo "  git add -A && git commit -m 'docs(handbook): adopt the work item method'"
