# Autohand AI orchestration

Autohand AI Cloud enables orchestration by default. New account sign-ins use Moa
as the lead; the existing account entitlement policy moves Free accounts to
Fantail. Saved model choices are preserved. Other providers and local models
keep their existing behavior.

The lead plans, edits code, runs tests, and integrates results. It can delegate
independent file discovery, symbol and AST summaries, and documentation lookup
to Fantail research workers. The default session limit is four threads: the
lead and three workers. Workers receive read-only inspection tools and return
compact findings with file references, contracts, documentation sources, and
uncertainties. Their private tool transcripts stay out of the lead's context.

Moa also provides independent, tool-free advice at three checkpoints:

1. Before `plan` or `exit_plan_mode` finalizes a plan.
2. After the same test, build, lint, or compiler command fails twice with the
   same output (ignoring timing differences).
3. Before staging or committing through the Git tools or a recognizable shell
   command, and before completing a turn that used tools.

Each review receives the current session conversation, including any earlier
context compaction, and the checkpoint evidence. Commit and completion reviews
also receive the workspace diff against HEAD, including staged and untracked
files, without changing the real Git index. Oversized or failed diff captures
are reported as unavailable, not approved. Non-Git workspaces are identified
explicitly in the review evidence. Arbitrary scripts that stage or commit
internally cannot be detected as Git checkpoints; the final review still runs.

The lead addresses requested changes before proceeding. An unavailable review
or three rejected checkpoints ends the turn as incomplete with the reason
visible. When a final answer is ready, it remains visible as an unreviewed or
unapproved draft alongside the review feedback. The turn retains a failed
footer and a prepared goal stays active with its successor queued. Goal
completion is persisted only after approval and final answer delivery succeed.
Resolve the review feedback and ask to continue; a visible draft is not proof
of approval. Simple chat and routine shell steps do not call the advisor. Advisor
requests share the run's request and token budgets, support cancellation, and
report usage with the lead. Moa reviews are disabled for known Free accounts;
when entitlements are unknown they run only if Moa or Auto is already selected.

Each review request has a five-minute generation deadline, including a fresh
deadline for the larger-output recovery request after an empty or output-limited
verdict. An unavailable checkpoint gets one further review attempt; all requests
count against the run budget. Escape can interrupt the review at any time.
Deadline expiry is identified as a timeout, separately from user cancellation.
Failures report the deadline, provider, or verdict-parsing stage, content length,
finish reason, and a bounded response ID when available, without recording raw
review text or HTTP bodies.
Invalid accepted HTTP JSON is identified separately and is not automatically
replayed by the transport. A late or malformed answer never counts as approval.

## Controls

- `/agents orchestration` shows the current setting.
- `/agents orchestration off` restores ordinary agent behavior.
- `/agents orchestration on` re-enables research workers and checkpoint reviews.
- `/model` changes the lead model.
- `/agents provider` changes the workers' default provider and model.
- `/agents provider <agent>` sets an agent-specific choice.
- `SUB_AGENTS_MODEL` and `SUB_AGENTS_PROVIDER` remain session overrides.

The orchestration setting is saved as `autohandai.orchestration`. Explicit
`features.multi_agent_v2.max_concurrent_threads_per_session` values override the
four-thread default. Worker model overrides remain supported; model suggestions
in agent definitions do not override Fantail while orchestration is enabled.
Moa reasoning effort is high for advisor requests. Fantail requests do not send
a reasoning-effort parameter.
