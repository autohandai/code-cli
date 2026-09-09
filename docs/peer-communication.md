# Communicate with local peers

For local listeners, model server ports, and agent transports, see [Required ports and agent transports](config-reference.md#required-ports-and-agent-transports). Peer IPC requires no TCP or UDP port.

Local peer communication connects independent Autohand sessions and their published
workers on the same machine. Select a recipient with `:`, send a message immediately,
and follow its delivery receipt. Models can discover peers, exchange correlated
replies, and coordinate shared build resources through dedicated tools.

Communication is opt-in. Existing `/peers` presence and file-awareness behavior
continues when communication is disabled. The local IPC implementation supports Unix
sockets on macOS and Linux. Windows communication fails closed with
`UNSUPPORTED_PLATFORM` until private pipe and process-job adapters are available.
The ordinary CLI remains usable with communication disabled on Windows.

## Enable communication

Merge this into your Autohand configuration, retaining your provider and other settings:

```json
{
  "sessions": {
    "communication": {
      "enabled": true,
      "alias": "builder",
      "scope": "workspace",
      "idleBehavior": "notify"
    }
  }
}
```

Restart the participating sessions after editing configuration. Give the other session
a different alias, such as `reviewer`. An alias starts with a letter and contains up to
64 letters, digits, dashes, or underscores. When omitted, Autohand creates a readable
project alias with an incarnation suffix.

Sessions normally discover one another through the same `AUTOHAND_HOME`. Separate
profiles remain isolated. To share discovery and resources while retaining separate
message storage, configure the same absolute `coordinationDirectory` in both profiles.
Use a directory owned by your OS user; directory ownership and permissions are checked.

## Choose the right scope

| Scope | Peers included |
| --- | --- |
| `workspace` | The same canonical workspace, including symlinked paths to it. |
| `repository` | The workspace and linked Git worktrees with the same common Git directory. Separate clones are separate repositories. |
| `machine` | Participating sessions of the same OS user in the shared coordination namespace. |

Both sender and receiver policies must authorize the scope. Listing or choosing a wider
scope never expands a narrower configured policy. Set both sessions to `repository` for
worktree collaboration, or `machine` for cross-project collaboration. Discovery starts
with the workspace even when a broader policy is available.

In the Autohand composer:

```text
/peers list workspace
/peers list repository
/peers list machine
```

Each entry includes an alias, project, root/run kind, availability and opaque peer ID.
Presence-only and unsupported entries cannot receive messages. A selected child run is
an exact execution; another attempt or successor does not inherit its address.

## Send from the composer

Type `:` at the beginning of the composer. Use the arrow keys to select a recipient and
Tab to accept. With the picker open, the first Enter accepts the selection. Type your
message and press Enter again to send:

```text
:reviewer The build is ready. Please inspect the output before the next build.
```

The sender's model is not called for a leading recipient send. This also works while
the sender is running a local turn. A receipt such as `accepted` means the receiver has
stored the message. It does not mean the receiver has read it or completed the request.

Within ordinary prose, a selected peer is a reference for the local model:

```text
Ask :builder whether the current build has finished.
```

That sentence runs a local model turn. The model may use `send_peer_message`; selecting
the reference alone sends nothing. The reference includes the exact instance/run ID,
and grants no transcript access or additional permissions.

Escape closes the picker while preserving the draft. Editing, queue restoration and
history recall retain selected identities and validate them again before submission.
A restarted peer or changed alias requires a new selection. URLs, times, ports,
Windows paths, emoji forms, code spans, fenced code, and `/` or `!` command input remain
literal. Multiline or bracketed-paste content is not automatically sent.

## Read and reply

Incoming messages produce a compact notification. Your draft and scrollback remain
intact. Open the inbox to inspect the message:

```text
/peers inbox
/peers reply <original-message-id> The review is complete; the next build can proceed.
/peers status <outgoing-message-id>
```

In the terminal inbox, arrows select messages, Enter expands or collapses the selected
message, `r` creates a reply draft, and Escape closes the screen. Previewing the inbox
does not mark messages consumed. A correlated reply still addresses the original
sender after the incoming message has been consumed.

Explicit command forms are useful when pasting an opaque target from discovery:

```text
/peers send <peer-id> Please finish the current build; do not terminate it.
/peers help
```

These are commands inside Autohand, not shell commands. RPC clients can invoke the same
authorized model tools and receive structured peer/resource events.

## Understand delivery states

| State | What it establishes |
| --- | --- |
| `pending` | The sender stored its intent; recipient acceptance is unresolved. |
| `accepted` | The exact recipient stored the message durably. |
| `consumed` | The message entered recorded context or an explicit inbox tool read. |
| `replied` | A correlated reply was accepted. |
| `rejected` / `expired` | A refusal or deadline outcome was established. |
| `unknown` | The last transition cannot be established after a connection or process failure. |

Inspect `outcome` as well as `state`. For example, `accepted` with `TARGET_ENDED` retains
the acceptance evidence while explaining that the selected child ended before reading.
Use status and the original message ID to investigate an unresolved send. Retrying with
a new ID creates another message. Neither consumption nor a reply proves that a build
or other requested work completed; ask for explicit completion evidence.

## Idle and busy behavior

The default `idleBehavior: "notify"` displays arrivals and waits for the user. During
a running turn, messages enter context at a safe boundary after the current tool/result
group. They do not terminate a running command or become local `/` or `!` commands.

Set `idleBehavior: "auto"` only when you want received messages to schedule work within
the current user goal and existing budgets. Automatic messages retain reply correlation,
and a conversation has an eight-message automatic budget by default. Permission dialogs,
cancellation and shutdown take precedence. Resource waits use events instead of repeated
provider calls. An idle teammate requires a task from its lead before starting new work.

## Next steps

- Follow the [two-session lab](peer-communication-lab.md) to verify discovery, delivery,
  reply correlation, and preserved drafts.
- Use [resource coordination](peer-resource-coordination.md) to control build admission.
- Read the [protocol and runtime reference](peer-communication-protocol.md) for security,
  persistence, limits, adapter contracts, and recovery.
