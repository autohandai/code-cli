# Research publication lifecycle management

Status: proposed design for [#432](https://github.com/autohandai/code-cli/issues/432). This document defines the CLI contract; it does not implement the commands.

## Decision

Introduce `/research` as the lifecycle namespace:

```text
/research publish <markdown-path>
/research list [--local|--account]
/research status <markdown-path|attempt-id|report-id> [--local]
/research rotate <markdown-path|report-id>
/research unpublish <markdown-path|report-id>
```

Keep `/publish-research <markdown-path>` as a compatibility alias indefinitely. Do not reinterpret its first path segment as a subcommand: a valid report can be named `list`, `status`, or `rotate`, and the current handler treats all arguments as a path (`src/commands/publish-research.ts:14-32`).

`/research` should declare `publish`, `list`, `status`, `rotate`, and `unpublish` in command metadata. The interactive composer already renders metadata-backed subcommands (`src/core/slashCommandTypes.ts:130-141`, `src/ui/inputPrompt.ts:353-374`), and existing handlers dispatch on the first argument (`src/commands/skills.ts:50-78`). Registering a namespace is therefore simpler than adding separately parsed multi-word command entries.

The first implementation should ship local `list` and authenticated `status`, `rotate`, and `unpublish` together. Account-wide listing can follow once the service exposes a bearer-authenticated JSON list endpoint. Until rotation ships, replace the current promise with a concrete browser route:

> This code is shown once. To rotate it, open `<Open Research origin>/account/publications/`.

The current modal and retry output promise an unspecified owner workflow (`src/research/TerminalResearchPublicationPrompts.ts:59-68`, `src/research/ResearchPublicationService.ts:137-153`). The Open Research service does expose the browser management page, but the CLI does not currently name it (Open Research service `docs/api-v1.md:61-69`).

## Verified current contract

The CLI was reviewed together with the sibling Open Research service source at commit `7927a156c4ee1d325f29527621585dad9d7fc4ca`. Service source establishes available server behavior; it is not proof that every endpoint is deployed at the configured production origin.

| Capability | CLI and local state | Open Research service | Design consequence |
| --- | --- | --- | --- |
| Identify a local attempt | A sidecar receipt stores the API origin, attempt ID, status URL, report ID, URL, visibility, and update time (`src/research/OpenResearchClient.ts:56-96`). | Attempt status is owner-only and returns state, failure code, report ID, and URL after commit (Open Research service `docs/api-v1.md:41-45`). | Local status is implementable now. |
| List owned reports | There is no lifecycle client or command; `/publish-research` only accepts a report path (`src/commands/publish-research.ts:14-32`). | An internal cursor-paginated owner query exists, but no JSON list route is registered (Open Research service `app/lib/server/report-repository.server.ts:13-29`, `app/lib/server/report-repository.server.ts:73-113`, `app/routes.ts:3-31`). | Start with local receipts; add an account list endpoint for cross-machine completeness. |
| Rotate a private code | The CLI schema only covers create, status, upload, and commit responses (`src/research/publicationContract.ts:30-94`). | `POST /api/v1/reports/:reportId/access-code/rotate` already authenticates the owner and returns a new code once (Open Research service `app/routes/api.v1.report-rotate-access.ts:17-60`). | Extend the CLI's v1 schemas and client; do not invent a duplicate endpoint. |
| Unpublish a report | The CLI recognizes `revoked` as an attempt state but exposes no mutation (`src/research/publicationContract.ts:11-19`). | `POST /api/v1/reports/:reportId/revoke` returns terminal `revoked` state, and attempt revoke is also available (Open Research service `app/routes/api.v1.report-revoke.ts:15-57`, `app/routes/api.v1.publication-revoke.ts:14-49`). | Map the user-facing `unpublish` verb to report revocation and preserve the receipt. |
| Authenticate management calls | Publication already sends the configured token as a bearer credential (`src/research/OpenResearchClient.ts:287-311`). | Owner authentication accepts the bearer token, validates it upstream, and derives the owner from that identity (Open Research service `app/lib/server/auth.server.ts:43-70`, `app/lib/server/auth.server.ts:73-107`). | Reuse the current login and request path; never accept an owner ID from CLI input. |

The service fixture currently advertises only the four draft-and-commit routes (Open Research service `contracts/publication-v1.json:1-22`). Adding lifecycle schemas and deterministic fixture coverage is required even though rotate and revoke routes already exist in the service source.

## Target resolution

All read and mutation commands use one resolver and return a typed target:

```ts
type PublicationTarget =
  | { source: 'receipt'; receiptPath: string; attemptId: string; reportId?: string }
  | { source: 'account'; reportId: string };
```

Resolution order is explicit, not heuristic:

1. `or_...` is a report ID and may be sent directly to owner report endpoints. The CLI contract already validates opaque `or_` identifiers (`src/research/publicationContract.ts:8-9`, `src/research/publicationContract.ts:55-57`).
2. `pa_...` is an attempt ID. Status may address it using the configured Open Research origin; rotate and unpublish require the status result to contain a report ID (`src/research/publicationContract.ts:47-58`).
3. Any other value is a workspace-relative or absolute Markdown path. Validate it with the existing containment routine, then append `.publication.json`, matching receipt construction (`src/research/ResearchManifestBuilder.ts:82-107`, `src/research/ResearchManifestBuilder.ts:243-258`).

Never trust an arbitrary origin or absolute request URL from a receipt. Management requests must reuse the same-origin `/api/v1/` guard already applied to publication routes (`src/research/OpenResearchClient.ts:470-480`). A receipt with an invalid schema, unsafe route, or mismatched workspace path is shown as `invalid local receipt`; it is not silently deleted.

## List

### Initial local behavior

`/research list` initially means `/research list --local`. It reads valid `*.publication.json` sidecars associated with saved research reports in the active workspace and prints:

```text
SOURCE  STATE       VISIBILITY  REPORT ID       UPDATED       REPORT
local   committed   private     or_...          2 hours ago   .autohand/research/agents.md
local   staging     public      —               1 day ago     notes/evals.md
```

This operation is offline and must not mutate receipts. The receipt contains enough information for a last-known row (`src/research/OpenResearchClient.ts:56-96`), but it does not currently persist an explicit last-known state. Until the additive receipt fields below exist, display `committed` only when `reportId` and `url` are present and display `unknown` otherwise.

Discovery must be bounded and symlink-safe. Start with reports known under `.autohand/research/` and direct sidecars explicitly supplied to `status`; do not recursively follow arbitrary workspace symlinks. A local row is workspace-scoped and may omit:

- publications created on another machine or checkout;
- publications whose report or receipt was deleted;
- receipts removed after a failed or expired attempt is retried—the publication path intentionally removes those terminal attempt receipts before starting fresh (`src/research/OpenResearchClient.ts:131-155`);
- later server-side lifecycle changes not yet refreshed locally.

Print `Local workspace receipts; use --account for the complete owner view` so the scope is never mistaken for account history.

### Account behavior

`/research list --account` requires a new additive service endpoint:

```http
GET /api/v1/reports?cursor=<opaque>&limit=<1..100>
Authorization: Bearer <session>
```

Recommended response:

```json
{
  "items": [
    {
      "reportId": "or_...",
      "title": "Agent evaluation",
      "visibility": "private",
      "state": "published",
      "revision": 1,
      "url": "https://.../research/or_.../",
      "publishedAt": "2026-07-17T00:00:00.000Z",
      "updatedAt": "2026-07-17T00:00:00.000Z",
      "lifecycleOperation": null
    }
  ],
  "nextCursor": null
}
```

The service already has an owner-scoped query with a default limit of 50, a maximum of 100, and an opaque next cursor (Open Research service `app/lib/server/report-repository.server.ts:73-113`). The new API route should adapt that internal snake-case record to a stable camel-case response and calculate the canonical URL server-side. Do not expose owner IDs, access verifiers, grants, object keys, or access codes.

Once available, unqualified `/research list` should merge account rows with unmatched local attempts and add a `SOURCE` value of `account`, `local`, or `both`. A network failure falls back to local rows with a warning; it must not make local history disappear.

## Status

`/research status <target>` is read-only. With a local receipt or attempt ID it calls the existing owner-only attempt status endpoint, whose schema contains every attempt state, expiry, failure code, missing assets, report ID, report URL, and optional revision (`src/research/publicationContract.ts:11-19`, `src/research/publicationContract.ts:47-58`). `--local` skips the network and labels the result `last known`.

Output rules:

| Server state | User-facing result | Receipt behavior |
| --- | --- | --- |
| `staging` | Upload incomplete; show missing asset count and expiry. | Record check time and last-known state. |
| `ready` | Ready to commit or resume publication. | Record check time and last-known state. |
| `committing` | Commit in progress; retry status, not commit. | Record check time and last-known state. |
| `committed` | Published; show visibility, report ID, URL, and revision. For private reports say that the code is not recoverable. | Preserve receipt and refresh canonical fields. |
| `failed` | Attempt failed; show the stable failure code and say a new publish may start a fresh attempt. | Preserve on status; publication retry owns cleanup. |
| `expired` | Attempt expired; say a new publish may start a fresh attempt. | Preserve on status; publication retry owns cleanup. |
| `revoked` | Publication revoked and unavailable; this attempt is terminal. | Preserve permanently and mark revoked. |

The publication client already treats committed as recoverable, failed/expired as eligible for a fresh attempt, and revoked as terminal (`src/research/OpenResearchClient.ts:131-149`). Status must not duplicate those mutations: querying cannot remove a receipt or create a new attempt.

Account-only report IDs obtained from the future list endpoint can display that list row. A later `GET /api/v1/reports/:reportId` is recommended for authoritative single-report refresh, but is not required for the first local-status implementation. Until that endpoint exists, do not synthesize attempt URLs from report IDs.

## Rotate access code

`/research rotate <target>` is valid only for a private, published report with a resolved report ID. The server operation replaces the verifier, invalidates existing grants, increments the verifier version, and returns a new code once (Open Research service `docs/api-v1.md:61-67`).

Flow:

1. Require a valid Autohand login and resolve the owner report without accepting an owner ID.
2. Fetch status when an attempt receipt is available and reject non-committed, public, or revoked targets before prompting.
3. Show a default-negative confirmation: `Rotate the access code for <title/report-id>? Existing codes and active grants will stop working.`
4. Do not let global `--yes`, unrestricted mode, or an LLM-supplied answer bypass this confirmation. The existing publish flow deliberately requires two explicit consent decisions (`src/research/TerminalResearchPublicationPrompts.ts:13-20`, `src/research/TerminalResearchPublicationPrompts.ts:38-56`).
5. Call `POST /api/v1/reports/:reportId/access-code/rotate` and validate `{ reportId, accessCode, accessCodeAvailable: true, accessVerifierVersion }`, matching the service route response (Open Research service `app/routes/api.v1.report-rotate-access.ts:45-59`).
6. Show the code in a one-time modal based on `showPrivateResult`, with the heading `Private access code rotated`. Clear all in-memory references when the modal closes; never write the code to a receipt, log, hook, telemetry event, RPC notification, or error.

The network commit and the display are separate outcomes. If the endpoint succeeds but the modal fails, report `Access code rotated, but the new one-time code could not be displayed. Rotate again to obtain another code.` Never report the mutation itself as failed. This preserves the committed-outcome rule already applied to private publication display failures (`src/research/ResearchPublicationService.ts:101-124`).

On success, update only non-secret receipt metadata: `lastLifecycleOperation: 'rotate'`, `lastLifecycleAt`, `accessVerifierVersion`, and `accessCodeDisplay: 'shown' | 'display_failed'`.

## Unpublish

`/research unpublish <target>` is the user-facing name for permanent report revocation. It is intentionally not called `delete`: the service keeps the report identity revoked while hiding reads, invalidating grants, purging public URLs, and queuing stored objects for deletion (Open Research service `docs/api-v1.md:65-71`).

Flow:

1. Require a resolved report ID and current authenticated status.
2. Show the title, report ID, visibility, and canonical URL.
3. Require a default-negative destructive confirmation whose copy says the operation is irreversible. Global `--yes` and unrestricted mode do not count as consent.
4. Call `POST /api/v1/reports/:reportId/revoke` and validate `{ reportId, state: 'revoked', idempotentReplay }`, matching the existing service response (Open Research service `app/routes/api.v1.report-revoke.ts:41-55`).
5. Report idempotent replay as success: `Research already unpublished`.

Do not delete the sidecar. Preserve the attempt ID, report ID, former URL, and timestamps, then add `lastKnownState: 'revoked'`, `revokedAt`, and `lastLifecycleOperation: 'unpublish'`. This keeps the existing rule coherent: a saved receipt whose server attempt is revoked remains terminal rather than silently starting a new attempt (`src/research/OpenResearchClient.ts:131-143`). The former URL must be labeled unavailable rather than rendered as an active link.

For an uncommitted `pa_...` target, expose a separate future verb such as `/research abandon-attempt`; do not overload `unpublish`. The service already has an attempt-revoke endpoint with different staging cleanup semantics (Open Research service `docs/api-v1.md:55-59`).

## Receipt evolution

Keep `schemaVersion: 1` and add optional lifecycle fields so older clients continue to recognize the receipt. A schema-version bump would cause the current reader to reject the sidecar and could bypass revoked-attempt protection (`src/research/OpenResearchClient.ts:75-96`, `src/research/OpenResearchClient.ts:403-437`).

```ts
interface RecoveryReceiptLifecycleFields {
  lastKnownState?: 'staging' | 'ready' | 'committing' | 'committed' | 'failed' | 'expired' | 'revoked';
  statusCheckedAt?: string;
  lastLifecycleOperation?: 'rotate' | 'unpublish';
  lastLifecycleAt?: string;
  revokedAt?: string;
  accessVerifierVersion?: number;
  accessCodeDisplay?: 'shown' | 'display_failed';
}
```

Writes continue to use a mode-`0600` temporary file and atomic move, matching current receipt persistence (`src/research/OpenResearchClient.ts:440-448`). The access code remains absent. Corrupt receipts are reported by lifecycle commands and left untouched for recovery; publication's existing tolerant reader behavior remains unchanged.

## Client and command boundaries

Extend `OpenResearchClient` with typed, cancellable methods rather than placing `fetch` in the command handler:

```ts
listReports(token, options): Promise<OwnedReportPage>
getAttemptStatus(attemptIdOrStatusUrl, token, options): Promise<AttemptStatusResponse>
rotateAccessCode(reportId, token, options): Promise<RotateAccessCodeResponse>
revokeReport(reportId, token, options): Promise<RevokeReportResponse>
```

All methods must reuse bearer authorization, safe same-origin URL resolution, the external abort signal, timeout composition, response-schema validation, and stable error classification already centralized in the publication client (`src/research/OpenResearchClient.ts:287-357`, `src/research/OpenResearchClient.ts:470-494`).

Add a `ResearchPublicationLifecycleService` to own target resolution, receipt reads/writes, consent, and truthful post-commit outcomes. The slash command should only parse arguments and format results, following the existing thin `/publish-research` boundary (`src/commands/publish-research.ts:8-32`).

`/research list` and local `status` may run non-interactively because they are read-only. `rotate` and `unpublish` are interactive-only until dedicated RPC methods can carry explicit per-operation consent. The current handler already has an interactive-only guard for `/publish-research` (`src/core/slashCommandHandler.ts:37-44`).

## Delivery sequence

1. Correct the current one-time-code wording to link the existing browser owner page.
2. Add local receipt discovery, target resolution, and read-only status with corruption and containment tests.
3. Add CLI schemas plus fixture cases for the service's existing rotate and report-revoke endpoints.
4. Implement rotate with explicit consent, cancellation, one-time display, and committed/display-failed outcome tests.
5. Implement unpublish with explicit consent, idempotent replay, retained-receipt, and revoked-terminal tests.
6. Add the service's bearer-authenticated report list endpoint and fixture contract, then merge account and local list results.
7. Add dedicated RPC/ACP lifecycle methods only after their consent and secret-redaction contract is reviewed.

The command implementation is TUI behavior and therefore needs Ink rendering plus PTY/Tuistory coverage for subcommand discovery, default-negative prompts, cancellation, one-time display, and Ctrl+C cleanup. Client tests must cover auth, timeout, external cancellation, unsafe routes, malformed schemas, idempotent revoke, and display failure after a committed rotation.

## Open questions and recommendations

1. **Extend API v1 or create v2?** Recommend additive v1 extensions. Rotate and revoke are already registered under `/api/v1/`; only account listing and the CLI's pinned schemas/fixture are missing (Open Research service `app/routes.ts:6-31`). Reserve v2 for incompatible response or authorization changes.
2. **Use `/publish-research` subcommands or `/research`?** Recommend `/research` as the lifecycle namespace and retain `/publish-research <path>` as an alias. This avoids path/subcommand ambiguity while using the composer's existing metadata subcommands (`src/ui/inputPrompt.ts:353-374`).
3. **What should unqualified `list` mean?** Recommend local-only in the first release, clearly labeled. After the account endpoint ships, merge account data with unmatched local attempts and fall back to local data on network failure.
4. **Should `status` mutate receipts?** Recommend refreshing last-known metadata only after a valid response; never delete a receipt, start an attempt, or retry a mutation from a status command.
5. **Should users type the report ID to unpublish?** Recommend one default-negative confirmation, not a typed-ID ceremony, because the prompt already displays immutable identity and the authenticated endpoint is idempotent. Never allow global `--yes` to answer it.
6. **Does unpublish mean reversible hiding?** Recommend no. Map it to terminal revoke and use explicit irreversible copy. If reversible visibility changes are later exposed, name them `/research visibility public|private`; the service already separates visibility transition from revoke (Open Research service `docs/api-v1.md:65-69`).
7. **How long are revoked receipts retained?** Recommend indefinitely unless the user explicitly removes the local report and receipt. They are small, contain no code, explain dead links, and prevent accidental replay.
8. **Are the lifecycle routes live in production?** Unknown from source inspection alone. Before CLI release, run authenticated canary contract tests against the configured Open Research origin for list, rotate, status, and revoke. Do not infer deployment from the sibling checkout.
9. **Should management be available through RPC/ACP immediately?** Recommend no. Ship interactive CLI consent first; design explicit RPC methods and secret-safe result delivery separately so an access code cannot leak through general event streams.
