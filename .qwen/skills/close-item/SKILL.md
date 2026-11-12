---
name: close-item
description: Check a work item against the closing conditions, get a developer's approval, and close it.
disable-model-invocation: true
argument-hint: "[work item, e.g. 0007 or 0007/child-02]"
---

Close work item: $ARGUMENTS

Follow [closing](handbook/work-items.md#closing). List every condition as met or unmet, with evidence, and stop if any is unmet.

Running this skill isn't approval. After the summary, **stop and wait** for a developer that [`CONTRIBUTING.md`](CONTRIBUTING.md) names to say "approved", and record who it was. Never merge.
