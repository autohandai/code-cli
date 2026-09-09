# Peer communication protocol and runtime reference

For local listeners, model server ports, and agent transports, see [Required ports and agent transports](config-reference.md#required-ports-and-agent-transports). Peer IPC requires no TCP or UDP port.

Autohand's local peer service uses authenticated JSON-RPC 2.0 over private Unix-domain
sockets. Each root process owns one endpoint; in-process delegates and stdio teammates
route through that root. A durable inbox establishes custody independently of terminal
rendering, provider execution and command permissions.

## Module boundaries

| Module | Responsibility |
| --- | --- |
| `ActiveAgentRegistry` and heartbeat | Atomic presence publication and removal of the exact owned incarnation. |
| `PeerScope`, `PeerDirectory` | Canonical workspace/repository identity, scoped discovery, bounded child enumeration and exact target resolution. |
| `PeerIdentity`, `PeerProtocol`, `LocalPeerTransport` | Key generation, authentication, validated bounded frames, backpressure, connections and request deadlines. |
| `PeerMessageStore`, `PeerMessaging` | Outbound intent, inbox custody, receipts, correlation, retention, subscriptions and root/run authorization. |
| `AgentPeerRuntime`, `PeerCommunicationRuntime` | Root lifecycle, persisted external context, safe boundaries, notifications and automatic turn scheduling. |
| `TeammatePeerBridge`, `AgentDelegator`, `SubAgent` | Parent-owned identities, inherited capabilities, run retirement and child tools. |
| `peerMention`, Ink composer, fallback prompt | Shared parsing, bound targets, direct sends, draft/history restoration and accessible inbox. |
| `ResourceCoordinator`, `CommandCoordinationGate` | Versioned policies, capacity-one reservations, managed launch ledger and process-tree ownership. |

No daemon, TCP port, gRPC runtime or additional package is required. Communication
configuration is independent of the pre-existing session-awareness configuration.

## Identity and discovery

`sessionId` identifies a saved conversation. `instanceId` identifies one root-process
incarnation and changes on restart. `runId` identifies one exact child execution.
`peerId` is an opaque hash of the instance/run tuple. An alias, PID, socket pathname or
saved session ID cannot replace that routing identity.

Presence records keep version 1 and add an optional `communication` extension with
protocol version, instance ID, endpoint, public key, capabilities and scope metadata.
The extension is validated separately: malformed communication metadata disables
messaging for that record while preserving valid legacy presence. New records use
instance-qualified filenames so two processes resuming one saved session cannot remove
or overwrite each other's advertisement.

Discovery is a hint; endpoint authentication establishes reachability. Exact routes
refresh the owning root's advertisement. Child addresses revalidate against that root's
bounded directory, rather than querying every peer on every send. Alias resolution
requires an unambiguous match. Both root policy and delegated run scope are checked.

The heartbeat interval is five seconds, with the existing 15-second stale threshold.
Heartbeats never establish that a workload process has finished. Machine listings use
sanitized display metadata and do not expose other sessions' transcripts or credentials.

## Private endpoint and authentication

Unix runtime directories and state files use owner checks, symlink checks and private
`0700`/`0600` modes. Socket creation handles Unix pathname limits by selecting a verified
short private runtime directory when necessary. Cleanup checks the owned endpoint and
incarnation; an unavailable listener is not permission to unlink an arbitrary socket.

Each root generates an Ed25519 key pair in memory. Only the canonical public SPKI key is
advertised. The peers exchange fresh 32-byte nonces and sign a domain-separated,
length-prefixed transcript containing protocol, roles, both instance IDs, both public
keys and both challenges. Both proofs must verify before application requests are
accepted. Replayed nonces, wrong keys and stale incarnations are rejected.

This protects against accidental routing, other OS users and untrusted model fields.
It does not isolate malicious code with unrestricted access to the same user's private
files. Windows support requires verified current-user pipe ACLs and process-job ownership;
the implementation currently rejects that adapter instead of opening a TCP fallback.

## Frames and methods

The wire format is UTF-8 newline-delimited JSON-RPC objects. The decoder handles split
and coalesced frames, including split multibyte characters. It bounds bytes before JSON
parsing, validates object shapes, honors writable-stream backpressure and settles pending
requests on disconnect. Protocol version `1` is separate from JSON-RPC version `"2.0"`.

Transport authentication precedes these application methods:

| Method | Authorized behavior |
| --- | --- |
| `peer.directory` | Enumerate live, addressable child runs of the authenticated root. |
| `peer.send` | Validate and durably accept a message for an exact root/run. |
| `peer.status` | Return a receipt for the authenticated sender's original message and target. |
| `peer.subscribe` | Validate the original sender/target and return its current receipt; later receipt updates use `peer.receipt`. |
| `peer.receipt` | Record a recipient-owned receipt against the sender's original outbox entry. |
| `peer.read` | Rejected over remote IPC; inbox reads belong to the caller's trusted local/root adapter. |

Resource operations are separately authorized coordinator calls through trusted local or
parent-bound adapters. Remote `resource.*` calls cannot acquire controller authority via
the messaging endpoint.

```json
{
  "jsonrpc": "2.0",
  "id": "rpc-attempt-1",
  "method": "peer.send",
  "params": {
    "version": 1,
    "messageId": "message-stable-across-retry",
    "to": "<exact-peer-id>",
    "content": "The build is ready for review."
  }
}
```

The root derives the sender from the authenticated connection or bound child channel.
The model cannot submit its own `from` principal. RPC IDs identify transport attempts;
message IDs identify durable messages. A notification without an acceptance response
cannot establish delivery.

## Durable custody and ordering

The sender persists its outbox intent before transmission. The receiver checks identity,
scope, capability, target liveness, content size, expiry and capacity, then commits the
inbox before returning `accepted`. Duplicate attempts use the authenticated sender
instance, message ID and recipient. Changing content under that identity yields
`MESSAGE_ID_CONFLICT`.

Sends serialize per sender/recipient route. An unresolved head is retried before a later
message advances on that route. The receiver assigns its own sequence at acceptance;
there is no invented global order across independent senders. Receipt events have durable
cursors and terminal transitions do not regress from replied/consumed to a delayed refusal.

Reply messages retain `replyTo` and the original correlation ID. Both sides validate the
exact conversation. A restarted root or completed child cannot silently receive replies
for its predecessor. An explicit outgoing tool call derives a retry-stable message ID
from the actual caller and tool-call ID; a new user submission gets a new message ID.

Provider calls and tool effects are not exactly-once. Delivery deduplication prevents
duplicate inbox entries; context and session records retain message identity to support
reconciliation. A context preparation marker is distinct from a consumed receipt. The
runtime records external context before advancing consumption, and the message store
retains a context journal for recovery.

## Safe provider and terminal boundaries

Peer text is wrapped as external collaboration data with sender/run identity, correlation
and authority metadata. A provider's user-role wrapper does not grant local-user authority.
Messages cannot modify permissions, the user goal or automation policy through their text.
They are never implicitly parsed as shell/slash commands, file references or attachments.

The root scheduler drains at safe boundaries after tool/result groups and rechecks arrival
generation before ending a turn. Root instruction admission serializes asynchronous
account preparation and provider startup. Cancellation applies before a provider is
entered. Automatic wakeups coalesce, wait for root activation, and respect modal, shutdown
and cancellation state. Fallback prompt suspension preserves text, cursor and bindings.

The Ink transcript owner renders notifications; socket callbacks do not print raw output.
Terminal control sequences are sanitized. The shared composer parser keeps exact peer
bindings through queue edits, history and remounts. Selecting a leading recipient is an
immediate operation; a selected inline reference becomes metadata for the local turn.

## Model tool contracts

| Tool | Inputs and behavior |
| --- | --- |
| `list_peers` | Optional `scope`, `query`, `cursor`; returns bounded safe descriptors and continuation cursor. |
| `send_peer_message` | Required `to`, `content`; optional `topic`, `replyTo`; returns actual custody receipt or a typed failure. |
| `peer_messages` | Optional `after`, `from`, `replyTo`, `messageId`, `waitMs`; reads the caller's mailbox and events. Waits are abortable and limited to 30 seconds. |
| `coordinate_resource` | Discriminated `status`, `request`, `grant`, `release`, `cancel_request`, `set_controller` operation. See the resource guide for required fields and authority. |

Root and child native-tool and text-tool paths both use these implementations.
Capabilities include `message.send`, `message.receive`, `message.wait`, `resource.request`
and `resource.control`. Delegates normally inherit message/request capabilities while
controller authority requires explicit delegation. Read-only external run records remain
read-only.

Teammates use their existing parent-owned stdio transport. Each request is bound to the
current task, execution and target run. The parent handles message/resource requests,
including launch-ledger publication, validates responses, bounds pending work and drains
requests during retirement. Children do not inherit endpoint private keys or open machine
listeners.

## Configuration reference

All fields are under `sessions.communication`:

| Field | Default | Meaning |
| --- | --- | --- |
| `enabled` | `false` | Start the local service and register available peer tools. |
| `scope` | `workspace` | Maximum authorized scope; narrower selection remains possible. |
| `idleBehavior` | `notify` | Display arrivals, or explicitly allow automatic turns with `auto`. |
| `alias` | Generated | Valid readable alias; exact routing remains incarnation-based. |
| `coordinationDirectory` | `AUTOHAND_HOME` | Shared presence, endpoint and resource namespace. |
| `allowResourceControl` | `false` | Authorize policy installation and controller grants. |
| `resourceWaitTimeoutMs` | `300000` | Hard command-admission wait; positive integer. |
| `limits` | Table below | Positive integer overrides, validated at startup. |

| Limit | Default |
| --- | --- |
| `frameBytes` / `messageBytes` | 65,536 / 8,000 UTF-8 bytes |
| `inboxMessages` | 32 unconsumed messages per recipient |
| `pendingRequests` / `connections` | 32 per connection / 16 cached outbound connections |
| `storageBytes` | 10 MiB per instance |
| `ratePerSecond` / `rateBurst` | 10 messages per second / burst 20 |
| `handshakeMs` / `acknowledgementMs` | 2,000 / 2,000 ms |
| `expiryMs` / `maxExpiryMs` | 10 minutes / one hour |
| `retentionMs` | 24 hours |
| `automaticReplies` | Eight automatic messages per conversation |
| `directoryPageSize` / `publishedRuns` | 50 peers per page / 64 live published runs |

Accepted/unresolved records are never silently dropped to admit new work. Admission
reserves space for receipt transitions and returns `QUEUE_FULL` when capacity is exhausted.
Message size cannot exceed frame size, and default expiry cannot exceed maximum expiry.
Automatic depth and the locally observed correlation budget both prevent unbounded reply
branching. A deliberate user message starts a new continuation.

## Storage and recovery

| Path | Contents |
| --- | --- |
| `<namespace>/active-agents` | Atomic, incarnation-qualified public presence metadata. |
| `<namespace>/peer-runtime` | Private local endpoints, or a verified short runtime alternative. |
| `<AUTOHAND_HOME>/peer-messages/<instance-id>/identity.json` | Saved-session and inbox-incarnation association. |
| `<AUTOHAND_HOME>/peer-messages/<instance-id>/messages.json` | Inbox, outbox, receipts, event cursors and recorded context. |
| `<namespace>/peer-resources/<resource-hash>.json` | Controller policy, tickets, holder, adopted blockers and resource event journal. |
| `<namespace>/peer-resources/launches.json` | Managed commands admitted before spawn and their process incarnation evidence. |

Metadata transactions use private files, short owner-aware locks and atomic writes.
Resource policy epochs invalidate unused grants; the launch ledger prevents a policy
change from overlooking a process admitted under an earlier policy. State corruption
returns `RECOVERY_REQUIRED`. It never frees an uncertain process or retargets old mail.

On restart, the new instance does not automatically execute previous unread messages.
The root's `recoverUnread({instanceId})` API validates the saved-session association and
returns old messages for explicit operator review. It does not move them into a new
target. Preserve original message IDs when comparing receipts and context records.
Use session privacy/deletion procedures for retained content; changing the shared
coordination directory does not move the private inbox.

Resource metadata retains active/unresolved ownership and bounds historical tickets and
event journals. A dead controller can be replaced by another explicitly authorized
principal. Missing process-start evidence requires operator investigation even when a
PID or heartbeat is absent. Never use file deletion or process termination as an implicit
resource-recovery action.

## Adapter events and observability

RPC output uses structured `peer_update` and `resource_update` events. ACP forwards the
corresponding extension events only after capability negotiation with the client; normal
ACP consumers retain their existing output contract. Message receipts carry their actual
state, original target and correlation. Resource events include resource, request, policy
epoch and sequence.

The built-in benchmark is `src/testing/scenarios/peerCommunicationBenchmark.ts`. It
launches independent local processes and reports cold/warm acceptance, inbox latency,
process resource counters, failures, lost messages and duplicates. Invoke it with
`bun src/testing/scenarios/peerCommunicationBenchmark.ts --run`. Measurements are specific
to the named host/runtime and do not include provider time. A compiled Bun/macOS probe
does not establish Linux or Windows runtime validation.

## Troubleshooting

| Outcome | Next action |
| --- | --- |
| `COMMUNICATION_DISABLED` | Enable the setting in each intended participant and restart. |
| `SCOPE_DENIED` | Compare both policies, child delegation, canonical workspace and namespace. |
| `PEER_OFFLINE` / `TARGET_ENDED` | Refresh discovery and deliberately select the current incarnation/run. Query the old outgoing ID before resending. |
| `AMBIGUOUS_TARGET` | Select an opaque ID or exact resource ticket instead of an alias/ambiguous reservation. |
| `INVALID_REPLY` | Use a message received from the exact target and retain its original message ID. |
| `QUEUE_FULL` | Let existing work consume/resolve; inspect storage limits without dropping accepted messages. |
| `RESOURCE_WAIT_TIMEOUT` | Inspect controller availability and the queue; no process was authorized by the timeout. |
| `STALE_POLICY` | Refresh resource status and request admission against the current epoch. |
| `RECOVERY_REQUIRED` | Preserve state and verify original message/process identity before explicit recovery. |
| `UNSUPPORTED_PLATFORM` | Keep communication disabled on an unimplemented platform adapter. |

See [the user guide](peer-communication.md), [resource coordination](peer-resource-coordination.md)
and [the two-session lab](peer-communication-lab.md) for working examples.
