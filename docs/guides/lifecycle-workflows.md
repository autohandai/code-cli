# Evidence-driven development workflows

Autohand provides three workflows for moving from an intended outcome to reviewed, tested code. Each uses the installed specialist catalogue and respects the session's shared thread budget. Specialist results must be checked before they become a final claim.

These workflow commands skip automatic environment bootstrap: invoking a review, cleanup, or test workflow does not itself install dependencies or synchronize Git. Needed setup remains an explicit, permission-checked step. `/pr-review` also keeps diagnostic intent so it does not trigger automatic implementation quality actions.

## Review a specific change

```text
/pr-review
/pr-review staged
/pr-review 482 focus on authorization and regression tests
/pr-review https://github.com/your-org/your-repo/pull/482
```

The default target is the local working tree, including staged and unstaged changes. `staged` narrows the review to the index. A PR number or GitHub URL targets that PR explicitly; Autohand does not choose an unrelated open PR when no target was supplied.

The workflow instructs `reviewer`, `security-auditor`, and `tester` to assess the patch read-only. It does not authorize edits, commits, pushes, posting comments, or submitting reviews. Findings include severity, confidence, a file/line reference, triggering conditions, impact, and a minimal correction suggestion. Suspicions that cannot be corroborated belong in questions, not confirmed findings. Existing permission rules still apply to every tool.

## Simplify code while preserving behavior

```text
/deslop
/deslop src/auth remove redundant wrappers without changing the public API
```

The default target is the current diff. `code-cleaner` identifies unnecessary complexity, and `tester` establishes behavior with characterization tests before production edits. Actual defects require a reproducing failing test first. Public APIs, necessary guards, unrelated user edits, and repository conventions remain intact. An empty default diff is not permission for repository-wide cleanup.

## Turn acceptance criteria into verified evidence

```text
/tester checkout should work with keyboard navigation and show a useful payment error
/tester run test
/tester run test:e2e -- checkout.spec.ts
/tester capture http://localhost:3000
/tester capture http://localhost:3000 testing/checkout-scenario.json
```

The plain-language workflow uses `requirements-translator`, `software-architect`, and `tester` as appropriate. It identifies the project's existing test framework, runs relevant checks, and reports each acceptance criterion as passed, failed, or not-run. It can call the native `capture_test_evidence` tool to collect real browser evidence. That tool is available to the tester specialist and asks for approval under the active permission policy because interaction steps can change the local app.

`/tester run` executes an explicitly selected, declared `package.json` script. It selects npm, Bun, pnpm, or Yarn from the project's package-manager declaration or lockfile and passes arguments without constructing a shell command. It records the exit code and up to 2 MB of output, with a 120-second command limit. Only run trusted scripts: the selected project script still controls its own behavior. The launcher never installs dependencies and disables package-manager network bootstrapping; missing runners or scripts are reported as not-run. Other frameworks remain available through the agent's normal, permission-checked command tools.

`/tester capture` uses an existing project installation of Playwright and an already-installed Chromium browser. It does not download either. Only an explicit localhost, `127.0.0.1`, or `[::1]` HTTP(S) URL is accepted. Start the intended local app separately, using its final URL: HTTP redirects and off-origin HTTP(S) requests are rejected. Responses are buffered, so this bounded capture is not suitable for streaming endpoints.

All WebSockets, including development hot reload, are blocked. WebRTC and WebTransport page APIs are disabled, and service workers are blocked. The installed Playwright must support these interception APIs or capture is reported as not-run. These are browser-level controls, not an operating-system network sandbox. Authenticated sessions from your personal browser are not reused; use only a trusted local test app.

A scenario file is a JSON array inside the workspace:

```json
[
  { "action": "fill", "selector": "#name", "value": "Test customer" },
  { "action": "click", "selector": "#save" },
  { "action": "waitFor", "selector": "text=Saved" }
]
```

Supported actions are `click`, `fill`, `press` (with `key`), and `waitFor`. Use only test data and explicitly authorized interactions. There are at most 20 steps, 24 retained frames, and 60 seconds per capture; defaults are six frames and 30 seconds. The animated WebP is a bounded clip made from actual captured frames, not a continuous video of every browser event. Individual PNGs and the Playwright trace remain alongside it.

Evidence is saved in unique `.autohand/test-evidence/run-*` directories with a Markdown report and JSON manifest. Script runs also contain `output.log`; browser captures retain PNG frames, `trace.zip`, and animated WebP when available. Open the report's artifact links in your editor or browser. An unavailable artifact is never listed as retained evidence, and failure to retain a test log is a failed evidence run even if the script itself exited zero. Screenshots, filled values, and traces can contain sensitive test data: inspect them before sharing and follow the project's retention policy. Autohand does not publish artifacts or upload the trace and animation automatically.

When the agent invokes `capture_test_evidence`, selected screenshot frames can be sent to the configured image-capable model provider for visual inspection. Treat that as model input, not local-only storage. The runtime keeps this image handoff temporary: session history and tool outcomes retain file references, not embedded image payloads. The direct `/tester capture` command only creates artifacts; it does not start a model inspection.

Cancellation is connected to the CLI's active ESC/Ctrl+C operation boundary; runners also have bounded timeouts. Failed or interrupted runs retain their honest partial results. A missing prerequisite is not a passing test.

Three distinct statements matter:

| Evidence | What it establishes |
| --- | --- |
| Project script exited successfully | The selected script returned zero; inspect its assertions and coverage before claiming the feature works. |
| Browser capture passed | The requested local interaction/capture completed and artifacts were produced. |
| Visual inspection completed | Someone actually opened and checked the relevant frames against expected behavior. |

Capture manifests remain `visualInspection: "not-run"`: capturing frames or delivering image input does not itself establish semantic correctness. The agent must actually inspect images and explain expected versus observed behavior before reporting visual confirmation. If image viewing is unavailable, it must say so and hand the user the artifacts. Playwright assertions, accessibility checks, and visual review complement each other; one cannot silently replace the others.
