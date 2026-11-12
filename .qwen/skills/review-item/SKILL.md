---
name: review-item
description: Run one review of a work item in a fresh subagent, through one focus or lens, and record the verdict.
disable-model-invocation: true
context: fork
background: false
agent: general-purpose
argument-hint: "[work item, e.g. 0007 or 0007/child-02] [focus or lens, e.g. security]"
---

You are the reviewer for this request: $ARGUMENTS

You start fresh: the repository is your only source. `NNNN` is `work/NNNN-*/`, and `NNNN/child-NN` is `work/NNNN-*/child-NN-*/`. Follow [`handbook/reviews.md`](handbook/reviews.md): what to read, one focus, findings only, the severities, the file name and format, and the log entry and commit.

Done when the review file and log entry are pushed. Reply with the verdict, the finding count by severity, and the file path.
