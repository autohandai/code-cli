# Repository discovery

Run `autohand discovery` in a repository to inspect its manifests, package
managers, CI configuration and distribution targets. The command starts a bundled
discovery worker in a subprocess. It does not launch an LLM or load repository
runtime extensions.

```sh
autohand discovery
autohand discovery list
autohand discovery push --dry-run
autohand discovery push --select repository-onboarding,ci-diagnosis
```

Discovery writes an evidence report to `.autohand/discovery.json` and editable
graph drafts to `.autohand/workflows/`. Repeat scans preserve existing drafts,
including manual edits. `--workspace`, `--path` and `--dir` select the repository;
`--json` emits structured results. A scan with `--dry-run` writes nothing.

`push` validates selected local graphs and uploads them to Build my agent. It
sends the selected graph documents and their evidence paths, not repository file
contents or the full discovery report. Inspect the exact payload with `--dry-run`
first. Uploads are limited to 20 workflows and 512 KB per request.

Only explicit pushes read authentication. `AUTOHAND_API_KEY` takes precedence;
otherwise the command reads the durable credential saved by `autohand login`,
respecting `--config` and `AUTOHAND_CONFIG`. It does not rewrite settings, execute
an API-key helper, or treat old browser expiry metadata as expiry of an `ahc_`
device credential. The server validates the credential. Credentials are passed
through the subprocess environment, never through command arguments or reports.

Open a returned editor link while signed into the same account. Refine the steps,
instructions and settings, then save. Repeating an unchanged push preserves those
browser edits; a changed local graph creates another saved workflow.

The default destination is `https://buildmyagent.autohand.ai`.
`BUILDMYAGENT_URL` may select an HTTP loopback development server; other hosts and
redirects are rejected. The hosted API must include the discovery import endpoint
and its database migration. CLI availability does not imply that the hosted
service has been upgraded.

Ctrl+C cancels the subprocess and its active upload; nonzero exit codes propagate
to the parent command. Discovery uses Git for a bounded ignored-file-aware
inventory, and a bounded fallback for non-Git folders. It skips generated folders,
symlinks and oversized inputs and reports omissions. Suggested check workflows
include a human approval step before executing project commands.

The scanner's source of truth is the sibling Build my agent repository. Regenerate
the embedded worker from that checkout with:

```sh
bun scripts/build-cli-discovery.ts /path/to/code-cli/src/discovery
```

The generated `workerSource.ts` includes its source checksum and bundles runtime
dependencies so npm and compiled CLI distributions use the same scanner. Run the
discovery CLI tests, built Tuistory test, type checks, lint, build and full proof
after updating it. The builder's tests cover scanner and upload contracts.
