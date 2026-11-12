# November 12 CLI issue sweep

The initial GitHub inventory contained 43 open issues, from 635 through 755. The scope is frozen in `.artifacts/issue-sweep-20261112/scope.json`; exact issue bodies and focused evidence are retained locally. The user subsequently set aside further investigation of 17 historical Cloud safety-verdict reports. There are 26 active issues in this sweep.

## Candidate changes

The candidate covers ACP questions, completion review, delegated-agent limits and partial results, patch safety, provider compatibility/deadlines, runtime local-model context, project-history recovery and storage-capacity handling. Each implemented defect started with a failing regression. Focused unit, actual protocol, and applicable built-CLI Tuistory evidence are recorded per issue.

The recovered work is inventoried separately in [Recovered CLI work](recovered-work-2026-11-12.md). Its 41 original working files and six local commits were preserved and reconciled. The five remaining unique feature branches are preservation findings, not implied additions to this issue sweep.

## Per-issue disposition

`Candidate fix` means implemented in the working tree, with integrated proof and publication still pending. It does not mean the historical upstream incident was independently reproduced. Existing-main fixes remain distinct from newly implemented changes.

| Issue | Disposition | Evidence or remaining action |
| --- | --- | --- |
| [#755](https://github.com/autohandai/code-cli/issues/755) | Candidate fix | Review completion after a capture-budget timeout using disclosed session evidence; retain approval and commit guards. |
| [#754](https://github.com/autohandai/code-cli/issues/754) | Candidate fix | Route ACP follow-up answers through capability-gated elicitation, with cancellation and session retirement. |
| [#751](https://github.com/autohandai/code-cli/issues/751) | Candidate fix | Use authoritative llama.cpp runtime context with bounded readiness and model-switch guards. |
| [#749](https://github.com/autohandai/code-cli/issues/749) | Candidate fix | Prevent disk-full turn replay and warn that recent data may be unsaved; historical write origin remains unverified. |
| [#746](https://github.com/autohandai/code-cli/issues/746) | Candidate fix | Use supported OpenAI sampling and reasoning parameters. |
| [#724](https://github.com/autohandai/code-cli/issues/724) | External configuration / evidence needed | Need sanitized HTTP status/body, endpoint/model revision and upstream request trace for the generic custom-provider failure. |
| [#722](https://github.com/autohandai/code-cli/issues/722) | Candidate fix | Retain malformed historical tool calls as text instead of invalid native arguments; original incident remains unverified. |
| [#721](https://github.com/autohandai/code-cli/issues/721) | Candidate fix | Retain malformed historical tool calls as text instead of invalid native arguments; original incident remains unverified. |
| [#720](https://github.com/autohandai/code-cli/issues/720) | Existing coverage / operational condition | Native function lists are already capped at 128; release verification remains separate. |
| [#719](https://github.com/autohandai/code-cli/issues/719) | Existing coverage / operational condition | Native function lists are already capped at 128; release verification remains separate. |
| [#718](https://github.com/autohandai/code-cli/issues/718) | External configuration / evidence needed | Select or configure the requested router model; client now identifies model_not_found without substituting a model. |
| [#715](https://github.com/autohandai/code-cli/issues/715) | Candidate fix | Stop replay after session metadata capacity failure; preserve existing data and report unsaved-state risk. |
| [#713](https://github.com/autohandai/code-cli/issues/713) | External configuration / evidence needed | Select or configure the requested router model; current historical server state is unverified. |
| [#712](https://github.com/autohandai/code-cli/issues/712) | External configuration / evidence needed | Duplicate report identity of 713; the same external router configuration remains unverified. |
| [#707](https://github.com/autohandai/code-cli/issues/707) | Existing coverage / operational condition | Current Cloud model policy already rejects Weka as an unsupported CLI lead model. |
| [#706](https://github.com/autohandai/code-cli/issues/706) | Candidate fix | Configurable delegated-agent limits, partial findings, explicit research scope, and native/Code Mode/protocol status. |
| [#705](https://github.com/autohandai/code-cli/issues/705) | External configuration / evidence needed | Need sanitized request shape, upstream request ID and prompt-template revision to diagnose the provider template failure. |
| [#704](https://github.com/autohandai/code-cli/issues/704) | Set aside by user | Historical safety-verdict investigation set aside at user request; no server false-positive fix claimed. |
| [#701](https://github.com/autohandai/code-cli/issues/701) | Set aside by user | Historical safety-verdict investigation set aside at user request; no server false-positive fix claimed. |
| [#700](https://github.com/autohandai/code-cli/issues/700) | Candidate fix | Apply supported single-file anchored/enveloped patches safely; reject ambiguity/no-ops and authorize rewritten targets. |
| [#692](https://github.com/autohandai/code-cli/issues/692) | External configuration / evidence needed | Need a WSL/device-login reproduction with redirect/account/API evidence; reporter follow-up remains absent. |
| [#691](https://github.com/autohandai/code-cli/issues/691) | Candidate fix | Enforce OpenRouter deadlines through complete body reads and forward configured network settings. |
| [#685](https://github.com/autohandai/code-cli/issues/685) | Existing coverage / operational condition | Existing client classifier handles the oMLX memory guard; actual server RAM/cache capacity remains operational. |
| [#679](https://github.com/autohandai/code-cli/issues/679) | Candidate fix | Use legitimate Autohand identity and opaque per-conversation routing on official Go endpoints. |
| [#670](https://github.com/autohandai/code-cli/issues/670) | Set aside by user | Historical safety-verdict investigation set aside at user request; no server false-positive fix claimed. |
| [#666](https://github.com/autohandai/code-cli/issues/666) | Set aside by user | Historical safety-verdict investigation set aside at user request; no server false-positive fix claimed. |
| [#663](https://github.com/autohandai/code-cli/issues/663) | Set aside by user | Historical safety-verdict investigation set aside at user request; no server false-positive fix claimed. |
| [#662](https://github.com/autohandai/code-cli/issues/662) | Candidate fix | Recover from malformed project-history rows without rewriting historical data. |
| [#661](https://github.com/autohandai/code-cli/issues/661) | Set aside by user | Historical safety-verdict investigation set aside at user request; no server false-positive fix claimed. |
| [#650](https://github.com/autohandai/code-cli/issues/650) | Set aside by user | Historical safety-verdict investigation set aside at user request; no server false-positive fix claimed. |
| [#649](https://github.com/autohandai/code-cli/issues/649) | Set aside by user | Historical safety-verdict investigation set aside at user request; no server false-positive fix claimed. |
| [#648](https://github.com/autohandai/code-cli/issues/648) | Set aside by user | Historical safety-verdict investigation set aside at user request; no server false-positive fix claimed. |
| [#647](https://github.com/autohandai/code-cli/issues/647) | Set aside by user | Historical safety-verdict investigation set aside at user request; no server false-positive fix claimed. |
| [#646](https://github.com/autohandai/code-cli/issues/646) | Set aside by user | Historical safety-verdict investigation set aside at user request; no server false-positive fix claimed. |
| [#645](https://github.com/autohandai/code-cli/issues/645) | Set aside by user | Historical safety-verdict investigation set aside at user request; no server false-positive fix claimed. |
| [#644](https://github.com/autohandai/code-cli/issues/644) | Candidate fix | Stop whole-turn replay after pre-request Managed Identity failure; retain explicit retry, credentials and auth mode. Historical host cause remains unverified. |
| [#643](https://github.com/autohandai/code-cli/issues/643) | Set aside by user | Historical safety-verdict investigation set aside at user request; no server false-positive fix claimed. |
| [#641](https://github.com/autohandai/code-cli/issues/641) | Candidate fix | Use compatible OpenAI endpoint, cap, reasoning and tool-continuation behavior. |
| [#640](https://github.com/autohandai/code-cli/issues/640) | Candidate fix | Same OpenAI compatibility family as 641. |
| [#639](https://github.com/autohandai/code-cli/issues/639) | Set aside by user | Historical safety-verdict investigation set aside at user request; no server false-positive fix claimed. |
| [#638](https://github.com/autohandai/code-cli/issues/638) | Set aside by user | Historical safety-verdict investigation set aside at user request; no server false-positive fix claimed. |
| [#637](https://github.com/autohandai/code-cli/issues/637) | Set aside by user | Historical safety-verdict investigation set aside at user request; no server false-positive fix claimed. |
| [#635](https://github.com/autohandai/code-cli/issues/635) | Set aside by user | Historical safety-verdict investigation set aside at user request; no server false-positive fix claimed. |

## Behavior and protocol boundaries

ACP clients advertising form elicitation receive SDK 1.7 `elicitation/create` requests. The answer schema is a plain string with suggestions in its description, so strict clients can accept arbitrary text. This supports free text; clients may need their own presentation support for quick-choice buttons. Declines, unavailable channels and transport failures remain distinct, and retired sessions cannot reuse an old question callback. Native Desktop rendering was not used as proof.

Patch support is intentionally single-file: numbered unified hunks, bare `@@` hunks, and an optional `*** Update File:` envelope. An envelope can supply an omitted target. Ambiguous matches, no-op patches, target conflicts, unsupported labeled unnumbered headers and multi-file directives fail with diagnostics. Logical and declared targets remain subject to permissions after input rewrites. The separately observed generic raw-symlink policy hazard and physical write atomicity are outside the patch-parser claim.

Storage capacity failures stop automatic replay because a transcript or tool write may already have succeeded before metadata persistence fails. The warning does not promise that the latest data was saved. No user caches, conversations, or historical log rows were deleted to resolve these failures.

Provider qualification uses deterministic request/response fixtures, actual loopback deadline tests and CLI scenarios. It does not establish paid live-provider acceptance, historical server configuration, Azure host availability, or resolution of an upstream safety verdict. The user-directed deferred reports retain this boundary without further evidence requests.

## Validation and delivery

This section records the investigation and development evidence before release qualification. Current publication status comes from the tagged release and its workflow, not the historical run summaries below.

The latest completed full proof used a checksum-verified project-local Bun 1.4.2, the version declared by this repository, and the supported two-worker terminal profile. Lint, typecheck, build and all 14,276 unit tests passed (986 files; 81 existing/platform skips). Its complete terminal selection reported 575 passing tests, two failures and three skips across 118 files. This is not a passing aggregate proof.

Both remaining failures were exact fixture mismatches. The crop fixture configured `high` reasoning but expected a legacy forced `none` value for GPT-5.4. The orchestration mock omitted `research_only: true` while expecting the restricted research envelope; production guidance and schema already specify that flag. The two minimal fixture corrections retain all crop pairing, model continuation, three-reader concurrency, Moa audit, tool-envelope, exit, timeout and skip checks.

The subsequent focused rerun could not qualify the corrections: macOS sleep logs confirm repeated maintenance sleep/dark-wake cycles during the run, with a nominal 60-second timeout taking more than 1,000 seconds. Its three readiness/timeout failures remain separate from the two reproduced assertion failures. Post-correction typecheck, targeted lint and diff checks pass. Targeted runtime confirmation and a fresh complete proof remain pending an awake, powered Mac. No test timeout, skip, or production behavior was changed to conceal these failures.

Earlier validation exposed and corrected these additional issues:

- Built-in skill discovery used an encoded URL pathname as a native filesystem path. Five portable registry-level cases now cover spaces and reserved/Unicode characters using `fileURLToPath`.
- Cursor's binary import fallback truncated encoded project URIs. Actual importer fixtures verify complete metadata/index association, decode-once behavior and message preservation. The correction applies to future imports; existing conversations and project aliases were not rewritten. Native Windows execution and the separate IDE Windows/UNC follow-up remain outside this claim.
- The Markdown renderer already emitted valid file URLs; its test now checks native-path roundtrips. The peer-resource test now observes an exact-child queued notice and durable cursor before waiting for the grant, retaining routing and bounded-cleanup assertions.
- Installed Bun 1.4.0 produced invalidly signed standalone executables in a dependency-free control. The declared Bun 1.4.2 passes signature verification and all four compiled scenarios. No global runtime, signing policy or dependency declaration changed.
- A tool-cap fixture returned Chat JSON to a Responses streaming route. Its contract is corrected with the 128-tool assertion retained.
- One repository preload and three temporary preloads used space-sensitive native paths in `NODE_OPTIONS`. Four actual preload failures were captured before the file-URL corrections. Both affected unit files pass 12 tests (two existing skips), and both affected terminal files pass five scenarios in the normal integration context. Worker-only socket denials remain separately recorded; no listener policy was changed.

Independent reviews verified patch authorization/parsing, ACP cancellation/session retirement, partial-result propagation, OpenAI serialization/cancellation and Cursor URI handling. The separately authorized QuickJS correction preserves the boolean image hint inside the VM while forwarding the actual image once to the model; base64 stays out of script observations. Focused results are not substitutes for the pending final aggregate qualification.

Remote main advanced during validation to `43614dbec51a3c56766cda3bb8f39ddcd1c459d7`, adding Keenable search and bounded OpenAI token recovery. Those changes are reconciled into the working files. Four overlaps merged cleanly; the OpenAI provider preserves the stricter recovery implementation, and both remote regressions remain alongside all local compatibility tests. A fresh build and six focused provider/search/setup/startup suites passed 196 tests.

Local Git metadata still points to `e59017ba7ca72066a051a3f24d5f473c9f9b4ed6`: this execution environment protects `.git` and rejected branch creation. The working-file reconciliation is not a commit or merge. A base-specific recovery patch and source hashes are retained under `.artifacts/issue-sweep-20261112/`. No issue has been closed or represented as released by this sweep. Publication requires complete release qualification and authorized Git integration.

The 0.9.11 candidate also incorporates the reviewed deny-all guard from PR #756. Five new regressions failed before the guard, and all 209 ACP, permission-advertising and specialist-runtime tests pass afterward. The guard blocks fabricated calls and implicit specialist preparation even in unrestricted mode; ACP advertises whether the run activated deny-all enforcement. The previously corrected crop and orchestration fixtures now pass all five targeted scenarios while the Mac is awake. Full release proof is recorded separately against the final versioned candidate.

Release-version validation also exposed a missing packed-ref fallback in the answer-only runtime identity reader. Synthetic ordinary/worktree packed-ref cases failed before reusing the existing repository reader; loose-ref precedence remains covered. All 50 identity, repository-reader and Homebrew tests pass, with lint, typecheck and build green. The legacy bundled Homebrew formula now matches 0.9.11; the production tap still receives verified archive checksums from the release pipeline.
