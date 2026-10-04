# Code mode

Code mode gives the agent one extra tool, `run_tool_script`. Instead of making
dozens of separate tool calls and reading every raw result, the agent writes one
JavaScript script that calls its tools, does the looping, filtering and
aggregation inside the script, and returns only the answer. Fewer round trips,
and the intermediate output never enters the model's context.

It is experimental and off by default.

## Enabling it

```bash
autohand experiments enable code_mode
```

or `/experiments enable code_mode` in a session, or in `~/.autohand/config.json`:

```json
{ "features": { "codeMode": true } }
```

The tool is added to (or removed from) a running session as soon as the feature
is toggled. Sub-agents and teammates do not get it.

## What a script looks like

The agent passes the body of an async function. Plain JavaScript; top-level
`await` and `return` are allowed.

```js
const found = await tools.find({ pattern: 'src/**/*.ts' });
if (!found.ok) return { error: found.error };

const files = found.output.split('\n').filter(Boolean).slice(0, 200);
const reads = await Promise.all(files.map((path) => tools.read_file({ path })));

const withTodo = files.filter((_, index) => reads[index].ok && reads[index].output.includes('TODO'));
console.log(`scanned ${files.length} files`);
return { scanned: files.length, withTodo };
```

- `tools.<name>(args)` takes the same arguments as the tool itself. MCP tools are
  called as `tools["mcp__server__tool"](args)`.
- Every call resolves to `{ ok: true, output }` or `{ ok: false, error, kind }`.
  Ordinary failures do not throw, so a script can handle them.
- Calls started together (`Promise.all`) are sent as one batch; reads in a batch
  run in parallel, writes and commands run one at a time, exactly as they do
  when the model issues several tool calls in one turn.
- `console.log/info/warn/error` output is captured.

The model receives one result:

```json
{
  "ok": true,
  "result": { "scanned": 200, "withTodo": ["src/a.ts"] },
  "logs": "scanned 200 files",
  "calls": { "total": 201, "failed": 0, "byTool": { "find": 1, "read_file": 200 } },
  "durationMs": 1840
}
```

The output of the individual calls is not included. That is the point.

## What a script can and cannot do

The script runs in a QuickJS WebAssembly isolate. It has no file system, network,
process, timers or module loading of its own: the only way out is `tools`, and
that bridge carries JSON text in both directions.

Callable from a script: the read, search, write, delete, git and shell tools,
`web_search`, `fetch_url`, `web_repo`, `package_info`, `recall_memory`, and MCP
tools.

Not callable: `run_tool_script` itself, delegation and team tools, `plan`,
`exit_plan_mode`, `ask_followup_question`, `todo_write`, tool and hook authoring
(`create_meta_tool`, `create_hook`, `set_lifecycle_hook`), tool discovery, and
computer-use tools.

## Permissions

A script has no permissions of its own. Each nested call goes through the same
path as a call made directly by the model:

1. client tool policy and the security blacklist
2. plan mode: while planning, a nested write or command is refused; reads work
3. your permission rules (`permissions.whitelist`, `blacklist`, mode)
4. `pre-tool` and `permission-request` hooks
5. the approval prompt, when the call needs one

`run_tool_script` itself never prompts: starting a script does nothing until the
script calls a tool.

If a nested call is denied (by you, by policy, by plan mode or by a hook) or the
turn is cancelled, the script stops there and the tool call fails with that
reason. It does not carry on and try something else.

Reads made by a script do not count as the model having read the file: with
`features.readBeforeWrite` on, the model still has to read a file itself before
it may edit it directly.

## Limits

| Limit | Value |
| --- | --- |
| Script execution time | 60 s by default, 300 s maximum (`timeout_ms`). Time spent inside tool calls, including waiting for an approval, is not counted |
| Nested tool calls | 200 per script |
| Memory | 64 MiB |
| Script size | 50,000 characters |
| Returned value | 20,000 characters, cut with an explicit marker |
| Captured logs | 4,000 characters |
| One tool result handed to the script | 1 MiB |

## Lifecycle hooks

`pre-tool`, `permission-request` and `post-tool` hooks fire for `run_tool_script`
and for every nested call. A nested call carries the id of the script that made
it:

- stdin JSON: `parent_tool_use_id`
- environment: `HOOK_PARENT_TOOL_CALL_ID`

Nested call ids are `<script call id>:<n>`. A `pre-tool` hook on
`run_tool_script` receives the script text in `tool_input.script` and can block
or rewrite it; hooks on the nested calls can block or rewrite those individually.

## JSON-RPC and ACP

Nested calls are reported like any other tool call, in order, between the
script's own start and end events.

- JSON-RPC: `autohand.toolStart` and `autohand.toolEnd` carry `parentToolId` for
  nested calls. `autohand.hook.preTool` / `autohand.hook.postTool` and
  `autohand.permissionRequest` are emitted for them as usual.
- ACP: nested `tool_call` and `tool_call_update` updates carry
  `_meta.autohand.parentToolCallId`; permission requests use
  `session/request_permission` as usual. `run_tool_script` is reported with kind
  `execute`.

Clients that ignore the new fields see a flat sequence of tool calls, which is
still correct.
