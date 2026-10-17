# Autohand Cloud in your terminal

Editorial draft. Keep unpublished until CLI and Desktop release readiness and native sign-in have been verified.

Start a hosted agent from the terminal, close the terminal while it works, and reconnect to the saved conversation. Autohand Cloud adds `--cloud`, `/cloud`, `/handoff`, and `/open` to the CLI. The same session can be reviewed in Code Web and an updated Autohand Desktop app.

Cloud CLI sessions are available only to Pro, Pro+, and Max accounts. Your selected account still needs active billing, model capacity, and permission to operate resources. A paid plan does not grant access to a repository that you have not authorized.

## Start a task where you work

```sh
autohand login
autohand --cloud --prompt "Investigate the parser regression"
```

The launcher offers an isolated repository workspace or a hosted conversation. For a workspace, choose an existing repository connection, repository, branch, and available managed sandbox provider. The CLI waits for attachment to finish before admitting the task. Repository grants and provider availability come from the hosted services.

For repeatable automation, choose those values explicitly:

```sh
autohand --cloud --cloud-account <account-id> \
  --cloud-repository owner/repository \
  --cloud-connector github-app:<connection-id> \
  --cloud-branch main --cloud-provider cloudflare \
  --prompt "Inspect the parser failure and propose a patch"
```

Use `--plan` for read-only investigation. Every submitted message then uses hosted plan mode, which denies mutating workspace operations. Pass `--plan` again when reconnecting to keep new messages read-only.

```sh
autohand --cloud --plan --prompt "Read the parser and explain the failing edge case"
```

![A live Autohand Cloud session started, observed and resumed in the terminal](https://autohand.ai/api/images/articles/cloud-cli-ba5f786a/cloud-terminal.gif)

This recording uses a real account, an authorized GitHub repository and a managed Cloudflare workspace. The task reads `package.json`; playback is accelerated to 1.5×.

## Enter queues; selecting a row controls steering

The cloud screen shows the saved conversation, active jobs, queued messages, and pending reviews. Enter queues your draft. Up/Down selects a queued row, and `/steer` sends that specific row as steering with its stored revision. Typing a correction does not approve a tool or replace another queued message.

Writes, commands, connector calls, and publishing retain the hosted review flow. `/approve` prints the full pending operation and asks for an explicit decision. `/decline` rejects it; `/answer` handles pending questions. A truncated screen preview is not the approval surface.

`/stop` cancels active work and pauses the queue. `/resume` rechecks account access and capacity before continuing it.

## Close the terminal and reconnect

Ctrl+C and `/detach` release the local observer. They do not send a remote stop request. The hosted Jobs service owns execution after admission, so work is independent of the terminal's HTTPS connection.

![A read-only cloud job running while the terminal observes its progress](https://autohand.ai/api/images/articles/cloud-cli-ba5f786a/cloud-terminal-running.png)

```sh
autohand --cloud --resume <session-id>
autohand --cloud --resume "https://dev.autohand.ai/c/<session-id>?account=<account-id>"
```

Reconnecting reads the saved transcript and queue. It never replays the old prompt. If admission returns an ambiguous network error, reconnect and inspect the queue before retrying. An unchanged draft retried in the same terminal retains its idempotency key.

![The saved cloud answer after reconnecting to the same account-owned session](https://autohand.ai/api/images/articles/cloud-cli-ba5f786a/cloud-terminal-resumed.png)

Hosted work can still stop for quota, expired authorization, provider failure, pending review, or an explicit stop. Detaching does not promise unlimited execution.

## Move a conversation between local and cloud execution

From a local interactive session, `/cloud [task]` starts fresh cloud work without uploading local history or files. `/handoff [task]` reviews and transfers the saved user and assistant conversation. When a Git repository is included, it also captures an exact revision and the selected local patch.

You can print the patch before authorizing upload. Tool messages, reasoning, and runtime configuration are excluded from the conversation transfer. Remove secrets from the conversation and patch before accepting it.

Inside the cloud screen, `/handoff` exports completed cloud work for local continuation. The cloud queue must be empty and the repository workspace must still be available for snapshot capture. The local import presents the patch for review and restores it into a separate checkout. If capture fails, the original cloud conversation remains available. Active plan mode carries through the handoff into the local continuation. Returning from that local continuation restores the original interactive session.

## Review the same session in Web or Desktop

```text
/open web
/open desktop
```

Code Web provides the full transcript and workspace. An updated Desktop build opens the same session in a native cloud window. Sign in to Code Web inside that window; the CLI does not copy its token into Desktop.

Desktop links carry only a session ID and account ID. The remote cloud window has no local native preload, Node integration, or access to the local agent bridge. Navigation permits Code Web, Console and the existing Autohand sign-in providers, while hosted ownership and approval checks remain in force.

## The security boundary stays on the server

The native CLI route authenticates a single account credential and forwards only allowlisted operations through the existing hosted API. It rechecks membership, ownership, write permissions, plan eligibility, model capacity, and repository grants. Browser cookies mixed with native bearer credentials are rejected. Responses remain private and are not cached.

Only Pro, Pro+, and Max can admit new cloud work through this interface. Owned stop and queue cleanup remain available after a downgrade. If durable Jobs are unavailable, admission fails instead of falling back to execution tied to the terminal request.

Local `--yes`, `--yolo`, custom MCP settings, system prompts, and tool-scope overrides cannot bypass hosted policy. Unsupported combinations fail before cloud launch. Local restrictions that Cloud cannot represent also fail closed. Read-only plan mode can preserve deny rules limited to mutating workspace operations; other custom restrictions require local execution.

The terminal reconnects its stream with bounded backoff, bounds retained observations, and releases readers and timers on detach. Credentials stay in HTTPS headers and never appear in session URLs. Managed sandboxes do not expose raw SSH credentials through this feature.

See the [Cloud CLI documentation](https://github.com/autohandai/code-cli/blob/main/docs/cloud.md) for flags, commands, handoff behavior, and account requirements.
