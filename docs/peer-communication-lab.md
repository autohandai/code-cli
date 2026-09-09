# Lab: exchange messages between two local sessions

This lab verifies the visible peer workflow with two sessions you control. It requires
a local build containing peer communication, two terminals, and one existing project.
The direct-send steps do not call the sender's model. Existing provider configuration
is needed to start normal Autohand sessions.

## 1. Configure two participants

Create two local configuration files by copying your working configuration. Retain the
provider settings. Merge this communication block into the first file:

```json
{
  "sessions": {
    "communication": {
      "enabled": true,
      "scope": "workspace",
      "alias": "reviewer",
      "idleBehavior": "notify"
    }
  }
}
```

Use `builder` as the alias in the second file. Launch each terminal from the same project,
using the same `AUTOHAND_HOME` and its own `AUTOHAND_CONFIG` path:

```sh
AUTOHAND_CONFIG=/absolute/path/reviewer.json autohand
```

```sh
AUTOHAND_CONFIG=/absolute/path/builder.json autohand
```

Checkpoint: `/peers list workspace` in each composer shows the other session's alias and
an available opaque peer ID. If either entry is presence-only, verify the running build
and configuration. Keep both sessions open for the remaining steps.

## 2. Select and send

In the reviewer session, type `:`. Select `builder` with the arrows and Tab, then enter:

```text
:builder Please confirm that this message reached your inbox.
```

Checkpoint: the reviewer sees an `accepted` receipt and the builder sees an incoming
notification. The reviewer's local model does not run for this direct send. If Enter
only accepts the open picker, press Enter again after finishing the message.

## 3. Inspect without consuming

In the builder session, type `/peers inbox`. Expand the message with Enter and then close
with Escape. In the reviewer session, use the message ID from the receipt:

```text
/peers status <message-id>
```

Checkpoint: preview alone leaves the message accepted and unread. The inbox explains
when consumption occurs. With `notify`, receiving a message does not start an idle turn.

## 4. Reply to the exact sender

Open the builder's inbox again, select the message and press `r`. Complete the reply draft
and submit it. Alternatively:

```text
/peers reply <message-id> Confirmed. I can see the original message.
```

Checkpoint: the reviewer receives a correlated reply and can inspect the original outgoing
status. A reply proves a response was accepted; it makes no claim about build completion.

## 5. Preserve an unfinished draft

Leave `Draft notes for my next task` in the reviewer's composer. Send another message from
the builder using `/peers send <reviewer-peer-id> Another update`.

Checkpoint: the notification arrives while the draft stays intact. Escape from the peer
picker also preserves the draft. Check history restoration with the arrow keys and confirm
that any restored recipient is still the exact selected instance.

## 6. Distinguish references from direct sends

Type `Ask :builder for a concise status update`, selecting the peer in the middle of the
sentence. Submit only when you intend to run a model turn.

Checkpoint: the local model receives an exact peer reference and may choose the authorized
send tool. The input is not treated as an immediate direct send. URLs such as
`https://localhost:3000`, `12:30` and `package:script` remain ordinary text.

## 7. Check worktree scope

Repeat with two linked worktrees and set both configurations to `repository` scope.
Restart both sessions, then run `/peers list repository`. For two different projects,
select `machine` in both policies and explicitly list machine peers.

Checkpoint: narrower workspace listings stay narrow, and separate profiles remain isolated
unless they share a configured coordination directory. A scope error never silently widens
the recipient's policy.

## 8. Check incarnation changes

Restore a draft addressed to the builder, then stop and restart the builder session.
Attempt to submit the old bound draft.

Checkpoint: the old binding is rejected or asks for reselection. Select the restarted
builder deliberately. Reusing the alias does not transfer the previous process's inbox
or pending replies to the new process.

## Continue with resource control

Follow [resource coordination](peer-resource-coordination.md) to enroll these sessions in
a build policy. Start with a harmless local build command and verify that a second command
waits until the controller grants it. Change the selected next ticket while a build runs,
then verify the current build finishes before another process starts.

Use the [protocol reference](peer-communication-protocol.md) to investigate receipts or
resource state. Keep the original IDs and logs when reporting a failure; do not infer a
successful workflow solely from a passing unit test.
