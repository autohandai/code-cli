---
name: write-goal
description: Help the user craft a well-specified `/goal` objective for goal mode. Use when the user asks for help writing, refining, or improving a goal, goal-mode objective, completion contract, autonomous run objective, proof, boundaries, or stop rule.
---

# Write a good goal

Help the user turn a rough intention into a `/goal` objective that goal mode can
pursue across many turns without supervision. A goal is not a task description;
it is a completion contract. It says what must become true, how that truth is
proven, where the work may and may not reach, and when to stop and report.

Drafting and starting are separate steps. Settle the wording first. Only once
the user has approved the exact objective should you call `create_goal`.

## Ask, do not narrate choices

When a decision has concrete options, use the host's user-question tool if it is
available. Do not write a prose menu and ask the user to answer in free text.

Examples of choices that should use the tool:

- narrow vs broad scope
- which proof command to use
- whether to include a budget
- which budget size
- which permission mode or execution mode to use

If no user-question tool is available, fall back to a short plain-text question
with clearly labeled options and wait. Open-ended questions are fine in prose.

## Rules

- Only help when the user asks for goal-writing help. Do not wrap ordinary work
  in goal mode on your own.
- Write the draft in the user's language.
- Always show the full drafted objective before starting it.
- Get explicit approval before calling `create_goal`.
- Draft with the user. Offer a draft, explain the choices, invite changes, and
  revise.
- If the user wants a looser goal after you point out the trade-off, write their
  version. Do not keep relitigating it.
- Do not set a token budget unless the user asks or the work is clearly
  open-ended enough that a budget is useful.
- Never bake a turn cap into the objective text.

## What makes a goal good

Strong goals define proof, not effort.

Include as many of these as the task warrants:

1. End state: the concrete condition that must become true.
2. Proof: observable evidence, preferably a command, test, search, file, or
   metric.
3. Boundaries: what may be touched and what is off limits.
4. Loop: how to iterate, such as rerunning a check after each change.
5. Stop rule: when to stop and report instead of forcing a pass.

Queue-shaped goals work best: failing tests, open issues, error traces, files to
migrate, rows to process. Lean on existing verification: tests, CI, typechecks,
lint, evals, browser checks, or zero-match searches.

## Workflow

1. Understand the intention. Ask what outcome the user wants and what would
   prove it is done.
2. Resolve missing finish lines or checks. When options are concrete, use the
   user-question tool.
3. Draft a concrete objective. Keep simple work to one or two sentences; use a
   short structured block for larger work.
4. Present the full draft and explain the finish line, proof, boundaries, and
   stop rule.
5. Revise until the user approves the exact text.
6. Start the goal with `create_goal` only after approval. Include a token budget
   only if one was agreed.

## Reusable shape

```text
<What must become true.>
Done when <command/search/state that proves it>.
Scope: only <files/area>; do not <off-limits action>.
Loop: <how to iterate, such as rerun the check after each change>.
If <blocking condition>, stop and report instead of forcing a pass.
```

Use only the lines that help. A small task can be a single clear sentence.

## Examples

Weak: `Find all bugs in this codebase.`

Strong: `Fix every test in test/auth that currently fails, rerun npm test until
it exits 0, change no file outside test/ or src/auth, and report anything you
cannot fix with its location and why.`

Weak: `Optimize the project.`

Strong: `Migrate the payment module to the new API, make npm test -- payment
exit 0, keep the diff limited to payment-related files, and stop and ask before
touching shared infrastructure.`

Weak: `Make it faster.`

Strong: `Make renderFrame at least 3x faster measured by the bench/render
benchmark; if you cannot reach 3x after several attempts, report the best result
and why.`

## Common mistakes

| Mistake | Better |
| --- | --- |
| Starting or suggesting a goal the user did not ask for | Only draft a goal once the user asks |
| Drafting in the wrong language | Match the user's language |
| Running before the user sees the exact text | Show the full draft and get agreement |
| Burying a discrete choice in prose | Use the user-question tool when available |
| Specifying effort | Specify proof |
| Setting a budget unprompted | Suggest a budget only when useful |
| No blocked path | Add an explicit stop-and-report rule |
| No way to verify completion | Anchor to tests, search, metric, file, or inspectable check |
