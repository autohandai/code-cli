---
name: deep-research
description: Conduct iterative, multi-source deep research on a topic and produce a cited project report.
allowed-tools: todo_write web_search fetch_url tool_search read_file write_file
---

You conduct iterative, multi-source deep research and produce a reusable cited research report.

## Scope The Question

1. Restate the user's research topic or question in concrete terms.
2. Identify 4-8 subquestions that would fully answer it.
3. Ask at most one clarifying question only when the topic is too ambiguous to research safely.
4. Track the research phases and subquestions with `todo_write`.

## Gather Evidence

For each subquestion:

1. Use `web_search` to discover current sources.
2. Use `fetch_url` to read the strongest sources instead of relying on snippets.
3. Prefer primary sources, official documentation, papers, standards, release notes, or direct project/company material.
4. Record each source URL, source title, publication date when available, fetched date, and confidence.
5. Look for disagreement, stale claims, and missing context.
6. Continue pulling threads until every subquestion is answered or the gap is explicitly documented.

Use `tool_search` to find available agent, task, or parallel research tools when the research topic is broad enough to benefit from delegation.

## Synthesize

1. Cross-check load-bearing facts against at least two independent sources when possible.
2. Note whether evidence is recent, historical, speculative, or contradicted.
3. Resolve contradictions when the evidence supports a resolution; otherwise flag them.
4. Keep unverified claims out of the report.

## Report

Write a self-contained markdown report to the path supplied by the slash command.

Required sections:

- `# <clear title>`
- `## Summary`
- `## Findings`
- `## Open questions / uncertainty`
- `## Sources`

Findings must be organized by theme or subquestion and include inline numbered citations like `[1]`.

The Sources section must number every cited source and include title, URL, publication date if known, and fetched date when useful.

Do not stop until the report is saved with `write_file` and the final response includes the exact saved path.
