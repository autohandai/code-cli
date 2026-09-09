# Repository discovery

Run `autohand discovery` in a repository or a folder containing several repositories.
It combines manifests, CI and distribution configuration, installed skills, scoped
user requests, and bounded Git observations to suggest useful engineering workflows.
The CLI shows the current collection stage, then ranked suggestions with reasons.
It uses an isolated discovery subprocess and does not load project extensions or
execute project scripts. The default scan works offline; `--analyze` adds an optional
model analysis through the built-in `workflow-discovery` skill.

```sh
autohand discovery
autohand discovery list
autohand discovery push --dry-run
autohand discovery push --select repository-onboarding,ci-diagnosis
autohand discovery --workspace /path/to/projects --depth 2
autohand discovery --skill-query "release" --no-behavior
autohand discovery --github --analyze
autohand discovery push --with-report --dry-run
autohand discovery push --with-report
autohand discovery --push
```

Discovery writes an evidence report to `.autohand/discovery.json` and editable
graph drafts to `.autohand/workflows/`. Repeat scans preserve existing drafts,
including manual edits. Fresh candidates are written to
`.autohand/discovery-candidates.json`; the summary identifies drafts that differ
from those candidates. `--workspace`, `--path` and `--dir` select the workspace;
`--json` emits structured results. A scan with `--dry-run` writes nothing.

`push` validates selected local graphs and uploads them to Build my agent. It
sends the selected graph documents and their evidence paths, not repository file
contents. `--with-report` includes the version 2 derived findings and asks the
server to match the catalogue and your saved workflows. The server stores reports
under your account. Raw conversations and skill bodies are excluded. Inspect the
exact payload with `--dry-run` first. Uploads are limited to 20 workflows and
512 KB per request. Narrow the workspace, skill query or selection if necessary.
`--push` scans, preserves local drafts, and uploads them with findings. Combined
with `--dry-run`, it previews freshly suggested graphs without writing or uploading.

Explicit uploads and optional model analysis read authentication. `AUTOHAND_API_KEY` takes precedence;
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
service has been upgraded. Findings uploads require the version 2 capability
advertised by `/api/discovery/capabilities`; an older server is rejected before
the upload. Plain `push` retains the graph-only contract.

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
after updating it. The builder's tests cover scanner, runtime skill resolution,
report ingestion and upload contracts.

## Collection scope

- Projects are discovered at the selected root and up to two directory levels
  below it. `--depth 0` selects only the root; `--depth 1` also includes immediate
  children. Generated discovery state does not count as a new repository.
- FFF (`fff_find`) supplies skill path candidates. Direct bounded searches cover
  hidden and ignored skill containers, including `.skills`, `skills`, agent
  directories and installed plugin layouts. Identical skill content is deduplicated
  while source locations remain visible. Project directory symlinks are not followed;
  installed skill aliases are resolved only within configured collection roots.
- Autohand typed history and session conversations, Claude project JSONL and Codex
  session JSONL are matched to their recorded working directory. Local user-message
  JSON and JSONL exports are also supported. Assistant/tool messages and injected context are excluded;
  mirrored Codex user events are deduplicated. `--no-behavior` skips history entirely.
  Topic counts summarize recurring requests and may overlap. They do not measure
  skill quality, prove user intent, or authorize execution.
- Git observations cover at most 200 commits from the last 30 days and 100 worktrees
  per repository. Worktree timestamps do not establish human activity. `--github`
  optionally reads up to 100 merged PRs using `gh`; unavailable provider history
  remains explicitly unknown. Binary inventory reads headers and sizes, never runs
  executables. CI release target strings are retained as distribution evidence.
- Project discovery is capped at 40 repositories and 2,000 directory entries.
  Skill reads are capped at 1,000 unique skills, 64 KiB per document and 16 MB total.
  History is capped at 2,000 files, 20,000 messages, 32 MB per file and 128 MB total.
  The report records partial collection. `AUTOHAND_DISCOVERY_HOME` selects an
  isolated user inventory root for fixtures; ordinary usage respects configured
  Autohand, Claude and Codex homes.

## Reviewing and running suggestions

Recommendations include a relevance score, evidence, matched skills, missing
prerequisites and proposed cadence. Scores are ranking heuristics, not quality
measurements. Optional analysis can reorder or omit existing candidates; unknown
candidate IDs, paths and skill hashes are rejected before drafts are written.
Its child process is limited to two iterations, 120 seconds and bounded input/output.

The editor shows discovery reasons and skill paths. Selected local skill references
carry a content hash. The connected runtime reads and verifies the referenced
`SKILL.md` before passing its guidance to the agent; missing or changed skills
stop the run with an actionable error. Skill bodies are not copied to the hosted
service. Remove or refresh a selection when moving workflows between machines.
Existing execution modes, curated skill selections, hook skills and configured
triggers survive CLI export/import. Imported triggers start paused. Proposed
cadences need a runtime and timing/event configuration before they can run.

The search design follows the explicit agent locations and bounded skill-container
searches in [skills.sh](https://github.com/vercel-labs/skills/blob/main/src/skills.ts),
alongside its [agent registry](https://github.com/vercel-labs/skills/blob/main/src/agents.ts).
