# Resource cleanup audit

This audit repairs ten resource-retention sites. Eight are independent copies of
the same provider cancellation defect; the other two retain deadline timers.

| # | Production site | Reproduced defect | Repair |
| --- | --- | --- | --- |
| 1 | `src/providers/AzureClient.ts` | Completed requests retain abort listeners on the caller signal. | Use `AbortSignal.any` and remove the manual signal combiner. |
| 2 | `src/providers/CerebrasClient.ts` | Completed requests retain abort listeners on the caller signal. | Use native signal composition and preserve cancellation as an `AbortError`. |
| 3 | `src/providers/LLMGatewayClient.ts` | Completed requests retain abort listeners on the caller signal. | Use native signal composition and preserve cancellation classification. |
| 4 | `src/providers/MLXProvider.ts` | One-shot abort listeners remain attached when requests finish without cancellation. | Remove the manual signal combiner. |
| 5 | `src/providers/NVIDIAClient.ts` | Completed requests retain abort listeners on the caller signal. | Use native signal composition and preserve cancellation classification. |
| 6 | `src/providers/OllamaProvider.ts` | One-shot abort listeners remain attached when requests finish without cancellation. | Remove the manual signal combiner. |
| 7 | `src/providers/OpenRouterClient.ts` | One-shot abort listeners remain attached when requests finish without cancellation. | Remove the manual signal combiner. |
| 8 | `src/providers/VertexAIProvider.ts` | Completed requests retain abort listeners on the caller signal. | Use native signal composition; classify cancellation before retry or token refresh. |
| 9 | `src/share/ShareApiClient.ts` | A failed health check leaves its five-second timeout scheduled. | Clear the deadline in `finally`. |
| 10 | `src/reporting/processErrorReporting.ts` | A report that settles first leaves its 6.5-second race deadline scheduled. | Keep and clear the deadline handle in `finally`; remove the obsolete sleep helper. |

## Regression evidence

The initial regression run failed 53 assertions across the three affected test
files. Each provider retained 12 extra caller listeners after 12 completed
requests. Both deadline defects left one timer after the operation settled.

`tests/providers/requestCleanup.test.ts` exercises the public completion API for
all eight providers. It checks repeated success, network and API failures,
already-aborted callers, timeouts, custom cancellation reasons, JSON body reads,
and streaming cancellation. Existing caller listeners must remain intact.

`tests/share/ShareApiClient.test.ts` checks health-check failure cleanup.
`tests/reporting/processErrorReporting.spec.ts` checks report success, failure,
and a report that never settles. The latter must still return at its deadline.

These are deterministic listener and timer lifecycle checks with mocked provider
responses. They do not measure production heap usage or establish that the
repository has no other leaks.

## Validation

Run the affected and adjacent suites with:

```sh
bun run test -- tests/providers tests/share/ShareApiClient.test.ts tests/reporting/processErrorReporting.spec.ts
bun run lint
bun run proof
```

The provider suite includes localhost HTTP fixtures and needs permission to bind
local ports. Full proof additionally builds the CLI and runs Tuistory scenarios.

The reviewed patch passed full `bun run proof` in an isolated checkout of
`cc93630a`: 8,886 unit/integration tests passed (35 skipped), ESM, CommonJS, and
declaration builds passed, and 107 Tuistory tests passed across 19 test files. Lint reported zero
errors and four existing warnings in the unchanged `CodingAgentControlPlane.ts`.
All 14 reviewed files were verified to match the shared checkout byte for byte.

The shared checkout's focused run passed 707 provider, sharing, and reporting
tests. Shared full runs encountered intermittent worker-start and unrelated
CLI, agent-status, and Git-initialization timeouts; isolated full proof supplied
the complete validation result without modifying the existing work in progress.
