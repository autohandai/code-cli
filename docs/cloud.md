# Autohand Cloud from your terminal

Cloud CLI sessions are available only to **Pro, Pro+, and Max** accounts. Free,
Lite, Team, and Enterprise accounts cannot start cloud work through this interface.
The selected account also needs write access, active billing, available model
capacity, and repository authorization. Sign in with `autohand login`.

## Start and reconnect

```sh
autohand --cloud
autohand --cloud --prompt "Investigate the parser regression"
autohand --cloud --plan --prompt "Read the parser and propose a fix"
autohand --cloud --resume
autohand --cloud --resume <session-id>
autohand --cloud --resume "https://dev.autohand.ai/c/<session-id>?account=<account-id>"
```

The terminal displays the hosted conversation, active job, queued messages, and
pending reviews. The model and tools run in Autohand Cloud. Closing the terminal
or pressing Ctrl+C detaches observation; it does not stop the remote job.
Reconnecting loads saved history and never replays your previous prompt.
Use `autohand resume <id>` for a local session.

The interactive launcher lets you select repository access, repository, branch,
and an available managed sandbox. A hosted conversation can also run without a
repository. To choose the workspace explicitly:

```sh
autohand --cloud --cloud-account <account-id> \
  --cloud-repository owner/repository \
  --cloud-connector github-app:<connection-id> \
  --cloud-branch main --cloud-provider cloudflare \
  --prompt "Inspect the test failure and propose a patch"
```

`--cloud-provider` accepts `cloudflare`, `daytona`, or `box` when the selected
provider is available. Connect repository access in [Code Web](https://dev.autohand.ai)
first. Server-side repository grants determine which repositories and branches
you may access. Workspace attachment must finish before the task is admitted.
Repository flags apply to new sessions; a resumed session keeps its workspace.
`--model` selects an available hosted model; the default is `auto`.

## Slash commands

From a local interactive session:

| Command | Behavior |
| --- | --- |
| `/cloud [task]` | Start a cloud session without uploading local history or files. |
| `/cloud --resume [ID or Web URL]` | Reconnect to an owned cloud session. Omit the reference to choose. |
| `/handoff [task]` or `/handoff cloud [task]` | Review and transfer saved conversation history and the current Git repository changes, then continue in Cloud. |
| `/open web` | Open the most recently attached cloud session in Code Web. |
| `/open desktop` | Open that session in an updated Autohand Desktop cloud window. |
| `/handoff web` | Existing private Web transfer flow; `--workspace` includes Git changes. |

Inside the cloud screen:

| Command | Behavior |
| --- | --- |
| `/open web` | Open this session's full transcript and workspace in Code Web. |
| `/open desktop` | Open this account-owned session in Autohand Desktop. |
| `/steer` | Send only the selected queued row as steering, guarded by its saved revision. |
| `/approve` | Print the full operation for review and ask for an explicit approval. |
| `/decline` | Reject the pending operation. |
| `/answer` | Answer the agent's pending questions. |
| `/stop` | Request cancellation of active work and pause the queue. |
| `/resume` | Resume the paused queue after rechecking access and capacity. |
| `/handoff` | Export completed cloud work, review the imported patch, and continue in a separate local checkout. |
| `/refresh` | Reload saved history and current queue state. |
| `/detach`, `/quit`, `/exit`, Ctrl+C | Leave the cloud view while remote work continues. |

Enter **queues** a message. Up/Down selects a queued row; `/steer` sends that
specific row. Nothing is automatically approved. Cloud-to-local handoff requires
the cloud queue to be empty and its repository workspace to remain available
for snapshot capture. Finish queued work or remove it in Code Web before handoff.
If capture fails, the original cloud conversation remains available and no local
checkout is imported. Returning from a nested local transfer session restores
the original local session.

`/open desktop` opens the same account-owned session in a native Autohand Desktop
cloud window. Install a Desktop build with cloud-session support and sign in to
Code Web in that window. The link carries only the session and account IDs; it
does not transfer your CLI token. Hosted permissions and approvals still apply.
This feature does not issue raw SSH credentials for managed sandboxes.

## Security and persistence

The CLI uses the signed-in account credential over HTTPS to the fixed
`https://dev.autohand.ai` origin. Credentials stay in request headers, never in
session URLs. Mixed browser cookies and native bearer credentials are rejected.
Account selection, membership, billing, ownership, model eligibility, capacity,
repository authorization, and sandbox restrictions are checked by the existing
hosted services. A resume link from another configured account needs an explicit
`--cloud-account` selection.

Cloud sends use the hosted `auto` approval mode. Writes, commands, publishing,
connector operations, questions, and skill decisions retain the hosted review
flow. `--plan` uses the server's read-only plan mode for every submitted message.
Pass `--plan` again when reconnecting to keep new messages read-only. An active
local plan mode carries into `/cloud` and `/handoff`; returning from a cloud
connection started with `--plan` also starts the local continuation in plan mode.
The terminal cannot bypass hosted checks using local `--yes`, `--yolo`,
`--unrestricted`, MCP configuration, system prompts, or tool-scope flags; these
incompatible combinations fail before cloud launch.

Custom local deny rules and tool scopes that Cloud cannot enforce also fail
before network access. Read-only plan mode can preserve restrictions limited to
`git_merge`, `write_file`, `delete_path`, and `apply_patch`, because hosted plan
mode denies mutating workspace actions. Other local restrictions remain local.
Neither cloud launch nor resume changes your provider, config, or local files.

`/handoff` transfers user and assistant history through the existing private
session-transfer service. It excludes tool messages, reasoning, and runtime
configuration. Repository changes are an explicit Git snapshot at an exact
revision. Review the patch before uploading; secrets typed into conversation or
contained in a selected patch remain your responsibility to remove.

Requests use durable idempotency keys. An ambiguous admission is not
automatically resubmitted. A manual retry of an unchanged draft retains its key;
after a terminal restart, reconnect and inspect the saved queue before retrying.
Observation reconnects with bounded backoff, frees response streams, and clears
timers on detach. Unavailable durable Jobs fail closed instead of falling back to
work tied to a terminal HTTPS request.

Cloud jobs can still stop because of quota, capacity, expired authorization,
provider failure, pending review, or an explicit stop. Detaching keeps the job
independent of the terminal; it does not promise unlimited execution.
