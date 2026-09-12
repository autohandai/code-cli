---
name: root-cause-analysis
description: Produce a written root-cause analysis for an incident, outage, regression, or recurring failure, with a timeline, contributing factors, and prevention actions. Use for post-mortems and "why did this happen" questions.
allowed-tools: read_file find_grep fff_find list_tree git_diff git_diff_range git_log git_status run_command
---

# Root-cause analysis

The goal is a document another engineer can act on: what happened, why it was
possible, and what stops the class of failure, not just this instance.

## Gather evidence first

1. Establish the timeline from artifacts, not memory: commits (`git_log`),
   deploys, config changes, alerts, logs, test runs. Timestamp everything.
2. Identify the trigger (the change or event) separately from the cause (why
   the system could not tolerate it) and the contributing factors (what let
   it reach users).
3. Reproduce or at least confirm the mechanism in code with file paths and
   line numbers. Quote the exact lines.

## Ask "why" until the answer is a design decision

Stop at a decision someone can change (a missing check, an assumed invariant,
a shared resource, an unbounded wait), not at "human error". People make the
same mistakes when the system makes them easy.

## Write the report

Use this shape, kept short:

- **Impact**: who, what, how long, blast radius.
- **Timeline**: bullet list with times.
- **Trigger**: the change or event.
- **Root cause**: the design gap, with code references.
- **Contributing factors**: detection, rollout, tests, ownership.
- **What went well**: what limited the damage.
- **Actions**: each with an owner-shaped verb, a test or check that would have
  caught it, and whether it prevents, detects, or mitigates. Prefer changes to
  the system over reminders to people.

## Verify before delivering

Every claim in the report must trace to evidence you collected. If something
is inferred, label it as such. Offer to open the follow-up tasks.
