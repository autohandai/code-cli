# Moa response timeout investigation — 2026-09-14

## Confirmed cause of the session failure

The CLI emitted the error and disabled recovery. The installed v0.9.7 executable
does not contain the cloud streaming implementation already present on local main.
Its agent loop requests a buffered response, waits for the entire completion, and
aborts after 300 seconds. `LLMGatewayClient.makeRequest()` classified that abort
as `ApiError('timeout', retryable: false)`, skipping both provider retries and
session recovery. A timeout does not establish that the prompt needs to be smaller.

The installed macOS arm64 executable matches the public v0.9.7 release asset:
`075526c422a450ccb3d55cfabada6bd30a107115672060e3dcbd0cc9ec47b518` (SHA-256).
The release was published on 2026-09-11 at 22:09:49 UTC. The v0.9.7 tag lacks the
streaming capability and agent-loop request changes found in the current checkout.

## Session and production evidence

Session: `4d1b7ed3-1b38-4e3a-96c5-774856a8e945-1789354155326`, provider `autohandai`,
model `moa`, CLI `0.9.7`.

| Evidence | Observed value |
| --- | --- |
| First user turn | 2026-09-14 02:51:15.377 UTC |
| Last tool result before the failure | 02:55:54.660 UTC |
| Exact timeout in the local error log | 03:00:54.679 UTC |
| Time from tool result to error | 300.019 seconds |
| Recorded turn duration | 579,930 ms, matching the displayed 9m 39s |
| Six completed production inference requests | 228,997 input tokens and 1,774 output tokens |
| Displayed usage | 229.0k input and 1.8k output |

Read-only queries against production `code-db.inference_usage_requests` match the
six completed requests to the session's timestamps and exact token totals. Their
actual model was `@cf/qwen/qwen3.8-27b`, served by Workers AI. The original user
request contained two images; the inference model resolver uses
`MOA_VISION_UPSTREAM_MODEL` for image-bearing Moa requests. Text-only Moa requests
in the same interval were served by `@cf/deepseek-ai/deepseek-v4-flash-0731`.

No completed ledger row was found for the request immediately after 02:55:54.
The ledger records completed usage, so this absence does not establish whether
that request stalled in queueing, generation, gateway inspection, or transport.
The query results reported zero rows written and no database changes.

A separate aggregate query of `error_reports` since 2026-08-25 found no reports
containing this exact timeout text. The inspected CLI `AutoReportManager` excludes
structured timeouts as operational errors. That reporting surface therefore cannot
establish how many other users encountered this failure.
The separate `telemetry` query for `session_failure_bug` events with the same text
and date range also returned no matching rows. No population-wide incident count
is established. Additionally, v0.9.7 derives the telemetry `isRetrying` flag from
`retryAttempt < maxRetries`, without checking whether recovery actually starts;
that flag is not evidence that a non-retryable timeout was retried.

The production inference deployment observed during this investigation serves
version `0c71ffee-4fdc-4634-8c48-ba08cdbbd25f` at 100%, deployed 2026-09-10.
The immutable version's bindings confirm DeepSeek V4 Flash for Moa text and Qwen
3.8 for Moa vision, with neither Dynamic Route variable configured.
Local source inspection alone is not proof that every local inference change is
included in that immutable version.

## Cross-project findings

- CLI: owns the 300-second abort, the quoted message, and the decision to skip
  recovery. The released agent loop omits streaming; current main supports it.
- API: `src/routes/inferenceProxy.ts` forwards the request and response through
  the inference service binding. It does not implement this timeout or buffer the
  response in the inspected source. Newer CLI source targets inference directly.
- Inference: buffered Workers AI calls await the full result; streaming calls
  return an event stream. The configured `cpu_ms: 300000` is a CPU budget, not a
  five-minute deadline for time spent waiting on inference.
- In the inspected inference source, caller cancellation is forwarded to named
  Workers AI calls only for Auto. Extending that to Moa/Fantail requires separate
  inference regression coverage and deployment validation; this investigation
  does not claim that a CLI abort cancels upstream Moa generation or refunds it.

Cloudflare distinguishes CPU time from network waiting in its
[Workers limits documentation](https://developers.cloudflare.com/workers/platform/limits/).
Its [DLP documentation](https://developers.cloudflare.com/ai-gateway/features/dlp/)
also documents response buffering when response inspection is enabled. The latter
is a possible latency contributor, not a verified cause for this failed request.

## CLI repair and release requirement

Timeouts before response headers now use the existing bounded retry/backoff policy
for both buffered and streaming requests. Retry callbacks keep the terminal
countdown informed. The error identifies the response deadline without blaming
request size. Existing cancellation handling and non-retryable partial-stream
failures remain in force.

Current main's streaming implementation is essential to the remedy: a completion
can run beyond five minutes while tokens or reasoning continue to arrive. Simply
retrying a buffered request can incur another full wait. Auxiliary callers that
omit streaming still use the buffered path and its completion header budget.

Users running the public v0.9.7 binary do not receive these local changes. A new
validated CLI release containing both streaming and timeout recovery is required.
No release, local binary replacement, production deployment, entitlement change,
or production inference replay was performed by this investigation.

## Validation

- Failing tests reproduced the exact 300-second message and `retryable: false`
  using fake timers; the bounded-attempt assertion also failed (one call rather
  than three).
- The corrected tests verify recovery for omitted/false streaming, bounded retry
  attempts, and a 400-second streamed Moa response with continuing reasoning.
- Provider, cancellation, stream parsing, and session-recovery tests passed in
  the targeted run. A separate tool-output rendering assertion failed in that
  aggregate run and passed unchanged both against archived HEAD and in a focused
  unrestricted rerun; its cause is not established by those passes.
- A subsequent eight-file run passed 319 tests, failed three startup UI tests,
  and skipped one. All provider/retry, cancellation, stream parsing, and command
  recovery tests in that run passed. The three startup cases also pass against
  the original `6027308c` snapshot, before concurrent UI/config changes. Two now
  fail because their UI host fixtures omit `runtime.config`; the other expects
  a cooked-input line to enter the queue. Neither path uses the timeout repair.
  The two tip suites that failed earlier now pass after concurrent corrections.
- `bun run build` and `bun run lint` passed.
- Both compiled cloud Tuistory cases passed outside the sandbox: first content
  before completion, and a visible timeout retry preserving the prior turn and
  identical retry messages. Ctrl+C cleanup passed. The initial sandbox run stalled
  during startup and incorrectly reported missing git; it is not successful
  terminal evidence.
- The initial `CI=true bun run proof` passed lint/typecheck but was interrupted
  with exit 130 while waiting on Git subprocesses in the sandbox. It is incomplete.
  The unrestricted run has also reported startup/tip failures and failures in
  `extensionsCliCommand.spec.ts`, `gitAutoCommit.spec.ts`,
  `autoresearchCliCommand.spec.ts`, `configCliCommands.spec.ts`, `command.spec.ts`,
  `WorkspaceFileCollector.mobile-query.test.ts`, and `shellBackground.test.ts`.
  A native sample showed the
  Vitest worker waiting inside synchronous child-process execution. This run
  was stopped with exit 130 after approximately 28 minutes, after those failures
  and concurrent changes to the checkout. Its log is preserved at
  `.autohand/timeout-investigation/proof-unrestricted.log`.
  Full proof is incomplete and has not passed; its aggregate build/Tuistory stage
  was not reached. The dedicated terminal scenarios above are focused evidence,
  not a substitute for the full release gate.
