# Concurrent Session Awareness Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make concurrent autohand sessions in the same project directory aware of one another, and warn at the moments where concurrent work causes damage.

**Architecture:** Extend the existing `ActiveAgentRegistry` (already heartbeating every 5s with dead-PID and staleness pruning) with an `activity` block. A new `src/session/peers/` module reads that registry, derives warnings through pure functions, and surfaces them through existing UI mechanisms. No new transport, no new timer, no git subprocess.

**Tech Stack:** TypeScript (strict), Vitest, Ink 7 / React 19, fs-extra, zod.

**Spec:** `docs/plans/2026-07-27-session-awareness-design.md`

## Global Constraints

- Ink `>=7.0.0`, React `>=19` — never downgrade.
- `fs-extra` MUST be imported as a default import (`import fse from 'fs-extra'`). Named imports break at runtime in ESM bundles.
- Drift detection MUST NOT spawn a `git` subprocess. Async `fs` reads of `.git` only.
- No synchronous filesystem or subprocess calls on any render or per-turn path.
- Tests are written before implementation. Every bug fix starts with a failing test.
- Run `bun run proof` before declaring any task complete.
- Every commit message ends with: `Co-authored-by: Autohand Evolve <code-noreply@autohand.ai>`
- Never add a `Co-Authored-By: Claude ...` trailer.
- Commit messages must not use `fix:` / `feat:` style prefixes.
- Peer-authored text (`instruction`, `command`) is untrusted and MUST pass through `sanitizeAnnouncementText` before display.
- Run single test files with `bun run test -- <file>`, never `bun test <file>`.

## File Structure

| File | Responsibility |
|---|---|
| `src/session/peers/RepoStateReader.ts` | Read branch + sha from `.git` with async `fs`. No subprocess. |
| `src/session/peers/PeerWarnings.ts` | Pure decision functions: peers + intent → warnings. No I/O. |
| `src/session/peers/PeerActivityPublisher.ts` | Build the `activity` block, including `phase` derivation, sanitization, clamping. |
| `src/session/peers/PeerAwarenessManager.ts` | Registry reads, peer diffing, drift baseline, read cache. The only surface the agent consumes. |
| `src/session/peers/index.ts` | Barrel. |
| `src/session/ActiveAgentRegistry.ts` | *(modify)* `activity` field, `0700`/`0600` permissions. |
| `src/types.ts` | *(modify)* `SessionsSettings` on `LoadedConfig`. |
| `src/commands/settings.ts` | *(modify)* `sessions.awareness` registry entry. |
| `src/core/agent.ts` | *(modify)* construct manager, feed publisher. |
| `src/core/actionExecutor.ts` | *(modify)* git guard, collision check. |
| `src/index.ts` | *(modify)* launch line. |
| `src/core/agent/AgentUIRuntime.ts` | *(modify)* peer status segment. |
| `src/commands/agents.ts` | *(modify)* richer detail. |
| `src/i18n/locales/en.json` | *(modify)* user-facing strings. |

---

### Task 1: RepoStateReader

**Files:**
- Create: `src/session/peers/RepoStateReader.ts`
- Test: `tests/session/peers/RepoStateReader.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `export interface RepoHead { branch: string | null; sha: string }` and `export async function readRepoHead(workspaceRoot: string): Promise<RepoHead | null>`.

- [ ] **Step 1: Write the failing test**

```ts
/**
 * @license
 * Copyright 2026 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import os from 'node:os';
import path from 'node:path';
import fse from 'fs-extra';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { readRepoHead } from '../../../src/session/peers/RepoStateReader.js';

const dirs: string[] = [];

async function makeGitDir(): Promise<string> {
  const root = await fse.mkdtemp(path.join(os.tmpdir(), 'autohand-repostate-'));
  dirs.push(root);
  await fse.ensureDir(path.join(root, '.git', 'refs', 'heads'));
  return root;
}

afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => fse.remove(dir)));
});

describe('readRepoHead', () => {
  it('reads a symbolic ref and its loose ref file', async () => {
    const root = await makeGitDir();
    await fse.writeFile(path.join(root, '.git', 'HEAD'), 'ref: refs/heads/main\n');
    await fse.writeFile(path.join(root, '.git', 'refs', 'heads', 'main'), 'abc123def456\n');

    expect(await readRepoHead(root)).toEqual({ branch: 'main', sha: 'abc123def456' });
  });

  it('reads a detached HEAD', async () => {
    const root = await makeGitDir();
    await fse.writeFile(path.join(root, '.git', 'HEAD'), 'deadbeefcafe\n');

    expect(await readRepoHead(root)).toEqual({ branch: null, sha: 'deadbeefcafe' });
  });

  it('falls back to packed-refs when the loose ref is absent', async () => {
    const root = await makeGitDir();
    await fse.writeFile(path.join(root, '.git', 'HEAD'), 'ref: refs/heads/feature\n');
    await fse.writeFile(
      path.join(root, '.git', 'packed-refs'),
      '# pack-refs with: peeled fully-peeled sorted\n'
      + '1111111111111111111111111111111111111111 refs/heads/main\n'
      + '2222222222222222222222222222222222222222 refs/heads/feature\n',
    );

    expect(await readRepoHead(root)).toEqual({
      branch: 'feature',
      sha: '2222222222222222222222222222222222222222',
    });
  });

  it('returns null outside a git repository', async () => {
    const root = await fse.mkdtemp(path.join(os.tmpdir(), 'autohand-norepo-'));
    dirs.push(root);
    expect(await readRepoHead(root)).toBeNull();
  });

  it('never spawns a subprocess', async () => {
    const childProcess = await import('node:child_process');
    const spawnSpy = vi.spyOn(childProcess, 'spawn');
    const execFileSpy = vi.spyOn(childProcess, 'execFile');
    const root = await makeGitDir();
    await fse.writeFile(path.join(root, '.git', 'HEAD'), 'ref: refs/heads/main\n');
    await fse.writeFile(path.join(root, '.git', 'refs', 'heads', 'main'), 'abc\n');

    await readRepoHead(root);

    expect(spawnSpy).not.toHaveBeenCalled();
    expect(execFileSpy).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun run test -- tests/session/peers/RepoStateReader.test.ts`
Expected: FAIL — `Cannot find module '../../../src/session/peers/RepoStateReader.js'`

- [ ] **Step 3: Write minimal implementation**

```ts
/**
 * @license
 * Copyright 2026 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import path from 'node:path';
import fse from 'fs-extra';

export interface RepoHead {
  branch: string | null;
  sha: string;
}

/**
 * Reads the current branch and commit straight from `.git`.
 *
 * Deliberately free of subprocesses: this runs on the heartbeat tick, and
 * spawning git there is the exact pattern that previously stalled the UI.
 */
export async function readRepoHead(workspaceRoot: string): Promise<RepoHead | null> {
  const gitDir = path.join(workspaceRoot, '.git');
  const head = await readTrimmed(path.join(gitDir, 'HEAD'));
  if (!head) {
    return null;
  }

  const symbolic = /^ref:\s*(.+)$/.exec(head);
  if (!symbolic) {
    return { branch: null, sha: head };
  }

  const ref = symbolic[1]!.trim();
  const branch = ref.startsWith('refs/heads/') ? ref.slice('refs/heads/'.length) : ref;

  const loose = await readTrimmed(path.join(gitDir, ref));
  if (loose) {
    return { branch, sha: loose };
  }

  const packed = await readTrimmed(path.join(gitDir, 'packed-refs'));
  if (!packed) {
    return null;
  }
  for (const line of packed.split('\n')) {
    if (line.startsWith('#') || line.startsWith('^')) continue;
    const [sha, name] = line.trim().split(/\s+/);
    if (name === ref && sha) {
      return { branch, sha };
    }
  }
  return null;
}

async function readTrimmed(filePath: string): Promise<string | null> {
  try {
    const contents = await fse.readFile(filePath, 'utf8');
    const trimmed = contents.trim();
    return trimmed.length > 0 ? trimmed : null;
  } catch {
    return null;
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun run test -- tests/session/peers/RepoStateReader.test.ts`
Expected: PASS (5 tests)

- [ ] **Step 5: Commit**

```bash
git add src/session/peers/RepoStateReader.ts tests/session/peers/RepoStateReader.test.ts
git commit -m "$(cat <<'EOF'
Read git HEAD without spawning a subprocess

Session awareness needs the current branch and commit on every heartbeat
tick. Reading .git directly keeps that off the process spawn path.

Co-authored-by: Autohand Evolve <code-noreply@autohand.ai>
EOF
)"
```

---

### Task 2: Registry record extension and permission hardening

**Files:**
- Modify: `src/session/ActiveAgentRegistry.ts:18-35` (record), `:63-66` (write)
- Test: `tests/session/ActiveAgentRegistry.test.ts`

**Interfaces:**
- Consumes: `RepoHead` from Task 1.
- Produces: `export interface ActiveAgentActivity` and an optional `activity?: ActiveAgentActivity` field on `ActiveAgentRecord`.

- [ ] **Step 1: Write the failing test**

Append to `tests/session/ActiveAgentRegistry.test.ts`:

```ts
describe('ActiveAgentRegistry activity', () => {
  it('round-trips the activity block', async () => {
    const dir = await fse.mkdtemp(path.join(os.tmpdir(), 'autohand-registry-'));
    const registry = new ActiveAgentRegistry(dir);
    const record = { ...baseRecord(), activity: {
      phase: 'editing' as const,
      instruction: 'refactor the auth module',
      pathsWritten: ['src/a.ts'],
      headRef: { branch: 'main', sha: 'abc' },
    } };

    await registry.write(record);
    const [loaded] = await registry.listActive();

    expect(loaded?.activity).toEqual(record.activity);
    await fse.remove(dir);
  });

  it('still accepts records written without activity', async () => {
    const dir = await fse.mkdtemp(path.join(os.tmpdir(), 'autohand-registry-'));
    const registry = new ActiveAgentRegistry(dir);

    await registry.write(baseRecord());
    const [loaded] = await registry.listActive();

    expect(loaded).toBeDefined();
    expect(loaded?.activity).toBeUndefined();
    await fse.remove(dir);
  });

  it('keeps the directory and records private', async () => {
    const dir = await fse.mkdtemp(path.join(os.tmpdir(), 'autohand-registry-'));
    const registry = new ActiveAgentRegistry(dir);

    await registry.write(baseRecord());

    const dirMode = (await fse.stat(dir)).mode & 0o777;
    const files = await fse.readdir(dir);
    const fileMode = (await fse.stat(path.join(dir, files[0]!))).mode & 0o777;

    expect(dirMode).toBe(0o700);
    expect(fileMode).toBe(0o600);
    await fse.remove(dir);
  });
});
```

Add a `baseRecord()` helper next to the existing fixtures in that file, returning a valid `ActiveAgentRecord` with `pid: process.pid` and `updatedAt: new Date().toISOString()`.

- [ ] **Step 2: Run test to verify it fails**

Run: `bun run test -- tests/session/ActiveAgentRegistry.test.ts`
Expected: FAIL — activity is dropped, and dir mode is `0o755`

- [ ] **Step 3: Write minimal implementation**

In `src/session/ActiveAgentRegistry.ts`, add above `ActiveAgentRecord`:

```ts
export type ActiveAgentPhase =
  | 'idle'
  | 'thinking'
  | 'editing'
  | 'running_command'
  | 'waiting_input';

export interface ActiveAgentActivity {
  phase: ActiveAgentPhase;
  /** Sanitized and clamped to 200 characters. */
  instruction?: string;
  /** Sanitized and clamped to 200 characters. */
  command?: string;
  /** Workspace-relative, newest first, max 20. */
  pathsWritten: string[];
  /** Populated only in the `coordinate` tier. */
  claims?: string[];
  headRef?: { branch: string | null; sha: string };
}
```

Add to `ActiveAgentRecord`: `activity?: ActiveAgentActivity;`

Replace `write`:

```ts
  async write(record: ActiveAgentRecord): Promise<void> {
    // Records carry the user's instruction text, so they are owner-only.
    await fse.ensureDir(this.dir, { mode: 0o700 });
    await fse.chmod(this.dir, 0o700).catch(() => {});
    await fse.writeJson(this.recordPath(record.sessionId), record, { spaces: 2, mode: 0o600 });
  }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun run test -- tests/session/ActiveAgentRegistry.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/session/ActiveAgentRegistry.ts tests/session/ActiveAgentRegistry.test.ts
git commit -m "$(cat <<'EOF'
Carry session activity in the active agent record

Add an optional activity block describing what a session is doing, and
tighten the registry to owner-only permissions now that records contain
instruction text.

Co-authored-by: Autohand Evolve <code-noreply@autohand.ai>
EOF
)"
```

---

### Task 3: PeerWarnings decision functions

**Files:**
- Create: `src/session/peers/PeerWarnings.ts`
- Test: `tests/session/peers/PeerWarnings.test.ts`

**Interfaces:**
- Consumes: `ActiveAgentRecord`, `ActiveAgentActivity` (Task 2).
- Produces:
  - `export type AwarenessTier = 'passive' | 'warn' | 'coordinate'`
  - `export interface PeerWarning { kind: 'git-mutation' | 'file-collision' | 'repo-drift' | 'claim-conflict'; message: string }`
  - `export function isGitMutationCommand(command: string): boolean`
  - `export function warnForGitMutation(tier, command, peers): PeerWarning[]`
  - `export function warnForFileWrite(tier, relativePath, peers): PeerWarning[]`
  - `export function warnForRepoDrift(tier, previous, current, peers): PeerWarning[]`

- [ ] **Step 1: Write the failing test**

```ts
/**
 * @license
 * Copyright 2026 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, expect, it } from 'vitest';
import {
  isGitMutationCommand,
  warnForFileWrite,
  warnForGitMutation,
  warnForRepoDrift,
} from '../../../src/session/peers/PeerWarnings.js';
import type { ActiveAgentRecord } from '../../../src/session/ActiveAgentRegistry.js';

function peer(overrides: Partial<ActiveAgentRecord> = {}): ActiveAgentRecord {
  return {
    version: 1,
    pid: 4242,
    sessionId: 'peer-1',
    workspaceRoot: '/repo',
    projectName: 'repo',
    provider: 'openrouter',
    model: 'claude',
    mode: 'interactive',
    status: 'working',
    startedAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    messageCount: 3,
    contextPercent: 90,
    tokensUsed: 10,
    activity: { phase: 'editing', pathsWritten: ['src/a.ts'] },
    ...overrides,
  };
}

describe('isGitMutationCommand', () => {
  it.each([
    'git commit -m "x"',
    'git merge main',
    'git rebase -i HEAD~2',
    'git reset --hard',
    'git checkout -b thing',
    'git switch main',
    'git push origin main',
    'git cherry-pick abc',
    '  GIT  COMMIT  -a ',
  ])('treats %j as a mutation', (command) => {
    expect(isGitMutationCommand(command)).toBe(true);
  });

  it.each(['git status', 'git log --oneline', 'git diff', 'gitk', 'legit commit', 'echo git commit'])(
    'treats %j as safe',
    (command) => {
      expect(isGitMutationCommand(command)).toBe(false);
    },
  );
});

describe('warnForGitMutation', () => {
  it('warns when a peer is active', () => {
    const warnings = warnForGitMutation('warn', 'git commit -m "x"', [peer()]);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]!.kind).toBe('git-mutation');
    expect(warnings[0]!.message).toContain('1 other session');
  });

  it('stays silent with no peers, on safe commands, and in the passive tier', () => {
    expect(warnForGitMutation('warn', 'git commit', [])).toEqual([]);
    expect(warnForGitMutation('warn', 'git status', [peer()])).toEqual([]);
    expect(warnForGitMutation('passive', 'git commit', [peer()])).toEqual([]);
  });
});

describe('warnForFileWrite', () => {
  it('warns when a peer wrote the same path', () => {
    const warnings = warnForFileWrite('warn', 'src/a.ts', [peer()]);
    expect(warnings[0]?.kind).toBe('file-collision');
    expect(warnings[0]?.message).toContain('src/a.ts');
  });

  it('ignores unrelated paths and the passive tier', () => {
    expect(warnForFileWrite('warn', 'src/other.ts', [peer()])).toEqual([]);
    expect(warnForFileWrite('passive', 'src/a.ts', [peer()])).toEqual([]);
  });
});

describe('warnForRepoDrift', () => {
  const before = { branch: 'main', sha: 'aaa' };

  it('warns when the sha moved', () => {
    const warnings = warnForRepoDrift('warn', before, { branch: 'main', sha: 'bbb' }, [peer()]);
    expect(warnings[0]?.kind).toBe('repo-drift');
  });

  it('stays silent when unchanged or in the passive tier', () => {
    expect(warnForRepoDrift('warn', before, { branch: 'main', sha: 'aaa' }, [peer()])).toEqual([]);
    expect(warnForRepoDrift('passive', before, { branch: 'main', sha: 'bbb' }, [peer()])).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun run test -- tests/session/peers/PeerWarnings.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Write minimal implementation**

```ts
/**
 * @license
 * Copyright 2026 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import type { ActiveAgentRecord } from '../ActiveAgentRegistry.js';
import type { RepoHead } from './RepoStateReader.js';

export type AwarenessTier = 'passive' | 'warn' | 'coordinate';

export interface PeerWarning {
  kind: 'git-mutation' | 'file-collision' | 'repo-drift' | 'claim-conflict';
  message: string;
}

const GIT_MUTATION_SUBCOMMANDS = new Set([
  'commit', 'merge', 'rebase', 'reset', 'checkout', 'switch', 'push', 'cherry-pick',
]);

/** True when the command is a git invocation that can move HEAD or the index. */
export function isGitMutationCommand(command: string): boolean {
  const tokens = command.trim().toLowerCase().split(/\s+/);
  const gitIndex = tokens.findIndex((token) => token === 'git' || token.endsWith('/git'));
  if (gitIndex !== 0) {
    return false;
  }
  const subcommand = tokens.slice(1).find((token) => !token.startsWith('-'));
  return subcommand !== undefined && GIT_MUTATION_SUBCOMMANDS.has(subcommand);
}

function warningsEnabled(tier: AwarenessTier): boolean {
  return tier === 'warn' || tier === 'coordinate';
}

function describePeers(peers: ActiveAgentRecord[]): string {
  return peers.length === 1 ? '1 other session' : `${peers.length} other sessions`;
}

export function warnForGitMutation(
  tier: AwarenessTier,
  command: string,
  peers: ActiveAgentRecord[],
): PeerWarning[] {
  if (!warningsEnabled(tier) || peers.length === 0 || !isGitMutationCommand(command)) {
    return [];
  }
  return [{
    kind: 'git-mutation',
    message: `${describePeers(peers)} active in this project. Check for work in flight before this git command changes shared state.`,
  }];
}

export function warnForFileWrite(
  tier: AwarenessTier,
  relativePath: string,
  peers: ActiveAgentRecord[],
): PeerWarning[] {
  if (!warningsEnabled(tier)) {
    return [];
  }
  const colliding = peers.filter((p) => p.activity?.pathsWritten?.includes(relativePath));
  if (colliding.length === 0) {
    return [];
  }
  return [{
    kind: 'file-collision',
    message: `${describePeers(colliding)} also wrote ${relativePath} recently.`,
  }];
}

export function warnForRepoDrift(
  tier: AwarenessTier,
  previous: RepoHead | null,
  current: RepoHead | null,
  peers: ActiveAgentRecord[],
): PeerWarning[] {
  if (!warningsEnabled(tier) || !previous || !current || previous.sha === current.sha) {
    return [];
  }
  const branch = current.branch ?? 'HEAD';
  return [{
    kind: 'repo-drift',
    message: `${branch} moved to ${current.sha.slice(0, 9)} outside this session${peers.length > 0 ? ` (${describePeers(peers)} active)` : ''}.`,
  }];
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun run test -- tests/session/peers/PeerWarnings.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/session/peers/PeerWarnings.ts tests/session/peers/PeerWarnings.test.ts
git commit -m "$(cat <<'EOF'
Decide session awareness warnings in pure functions

Keep the warning rules free of filesystem and UI dependencies so the
tier gating, git command classification, and collision logic are
directly testable.

Co-authored-by: Autohand Evolve <code-noreply@autohand.ai>
EOF
)"
```

---

### Task 4: PeerActivityPublisher

**Files:**
- Create: `src/session/peers/PeerActivityPublisher.ts`
- Test: `tests/session/peers/PeerActivityPublisher.test.ts`

**Interfaces:**
- Consumes: `ActiveAgentActivity`, `ActiveAgentPhase` (Task 2); `sanitizeAnnouncementText` from `src/announcements/AnnouncementContent.js`; `RepoHead` (Task 1).
- Produces:
  - `export interface ActivityInput { isInstructionActive: boolean; awaitingInput: boolean; activeTool?: string; instruction?: string; command?: string; pathsWritten: string[]; headRef?: RepoHead | null; claims?: string[] }`
  - `export function derivePhase(input: ActivityInput): ActiveAgentPhase`
  - `export function buildActivity(input: ActivityInput): ActiveAgentActivity`

- [ ] **Step 1: Write the failing test**

```ts
/**
 * @license
 * Copyright 2026 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, expect, it } from 'vitest';
import { buildActivity, derivePhase } from '../../../src/session/peers/PeerActivityPublisher.js';

const base = { isInstructionActive: true, awaitingInput: false, pathsWritten: [] };

describe('derivePhase', () => {
  it('reports idle when no instruction is running', () => {
    expect(derivePhase({ ...base, isInstructionActive: false })).toBe('idle');
  });

  it('reports waiting_input ahead of any tool phase', () => {
    expect(derivePhase({ ...base, awaitingInput: true, activeTool: 'run_command' })).toBe('waiting_input');
  });

  it.each(['run_command', 'shell'])('reports running_command for %s', (activeTool) => {
    expect(derivePhase({ ...base, activeTool })).toBe('running_command');
  });

  it.each(['apply_patch', 'write_file', 'replace_in_file'])('reports editing for %s', (activeTool) => {
    expect(derivePhase({ ...base, activeTool })).toBe('editing');
  });

  it('falls back to thinking', () => {
    expect(derivePhase({ ...base, activeTool: 'read_file' })).toBe('thinking');
  });
});

describe('buildActivity', () => {
  it('clamps paths to the twenty most recent, newest first', () => {
    const pathsWritten = Array.from({ length: 30 }, (_, i) => `src/f${i}.ts`);
    const activity = buildActivity({ ...base, pathsWritten });

    expect(activity.pathsWritten).toHaveLength(20);
    expect(activity.pathsWritten[0]).toBe('src/f0.ts');
  });

  it('sanitizes and clamps peer-visible text', () => {
    const activity = buildActivity({
      ...base,
      instruction: `[2Jrefactor ${'x'.repeat(400)}`,
      command: 'git commit‮moc.live',
    });

    expect(activity.instruction).not.toContain('');
    expect(activity.instruction).not.toContain('[2J');
    expect(activity.instruction!.length).toBeLessThanOrEqual(200);
    expect(activity.command).not.toContain('‮');
  });

  it('omits empty optional fields', () => {
    const activity = buildActivity(base);
    expect(activity.instruction).toBeUndefined();
    expect(activity.command).toBeUndefined();
    expect(activity.claims).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun run test -- tests/session/peers/PeerActivityPublisher.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Write minimal implementation**

```ts
/**
 * @license
 * Copyright 2026 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { sanitizeAnnouncementText } from '../../announcements/AnnouncementContent.js';
import type { ActiveAgentActivity, ActiveAgentPhase } from '../ActiveAgentRegistry.js';
import type { RepoHead } from './RepoStateReader.js';

const MAX_TEXT_CHARACTERS = 200;
const MAX_PATHS = 20;
const COMMAND_TOOLS = new Set(['run_command', 'shell']);
const EDITING_TOOLS = new Set([
  'apply_patch', 'write_file', 'replace_in_file', 'format_file', 'create_directory',
  'delete_path', 'rename_path', 'copy_path',
]);

export interface ActivityInput {
  isInstructionActive: boolean;
  awaitingInput: boolean;
  activeTool?: string;
  instruction?: string;
  command?: string;
  pathsWritten: string[];
  headRef?: RepoHead | null;
  claims?: string[];
}

export function derivePhase(input: ActivityInput): ActiveAgentPhase {
  if (!input.isInstructionActive) return 'idle';
  if (input.awaitingInput) return 'waiting_input';
  if (input.activeTool && COMMAND_TOOLS.has(input.activeTool)) return 'running_command';
  if (input.activeTool && EDITING_TOOLS.has(input.activeTool)) return 'editing';
  return 'thinking';
}

/** Peers render this text in their own terminal, so it is sanitized like any untrusted input. */
function publishableText(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const clean = sanitizeAnnouncementText(value, {
    maxCharacters: MAX_TEXT_CHARACTERS,
    preserveParagraphs: false,
  });
  return clean.length > 0 ? clean : undefined;
}

export function buildActivity(input: ActivityInput): ActiveAgentActivity {
  const instruction = publishableText(input.instruction);
  const command = publishableText(input.command);
  const claims = input.claims && input.claims.length > 0 ? [...input.claims] : undefined;

  return {
    phase: derivePhase(input),
    ...(instruction ? { instruction } : {}),
    ...(command ? { command } : {}),
    pathsWritten: input.pathsWritten.slice(0, MAX_PATHS),
    ...(claims ? { claims } : {}),
    ...(input.headRef ? { headRef: input.headRef } : {}),
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun run test -- tests/session/peers/PeerActivityPublisher.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/session/peers/PeerActivityPublisher.ts tests/session/peers/PeerActivityPublisher.test.ts
git commit -m "$(cat <<'EOF'
Publish session activity with sanitized peer-visible text

Derive the session phase from state the agent already holds, and clamp
and sanitize instruction and command strings before other sessions
render them in their own terminals.

Co-authored-by: Autohand Evolve <code-noreply@autohand.ai>
EOF
)"
```

---

### Task 5: PeerAwarenessManager

**Files:**
- Create: `src/session/peers/PeerAwarenessManager.ts`, `src/session/peers/index.ts`
- Test: `tests/session/peers/PeerAwarenessManager.test.ts`

**Interfaces:**
- Consumes: everything from Tasks 1–4.
- Produces:
  - `export class PeerAwarenessManager`
  - `constructor(options: { workspaceRoot: string; sessionId: string; tier: AwarenessTier; registry?: ActiveAgentRegistry; readHead?: typeof readRepoHead })`
  - `getPeers(): ActiveAgentRecord[]`
  - `refresh(): Promise<{ joined: ActiveAgentRecord[]; left: ActiveAgentRecord[]; warnings: PeerWarning[] }>`
  - `adoptRepoBaseline(): Promise<void>`
  - `recordRead(relativePath: string, mtimeMs: number): void`
  - `warnForWrite(relativePath: string): PeerWarning[]`
  - `warnForCommand(command: string): PeerWarning[]`

- [ ] **Step 1: Write the failing test**

```ts
/**
 * @license
 * Copyright 2026 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import os from 'node:os';
import path from 'node:path';
import fse from 'fs-extra';
import { afterEach, describe, expect, it } from 'vitest';
import { PeerAwarenessManager } from '../../../src/session/peers/PeerAwarenessManager.js';
import { ActiveAgentRegistry, type ActiveAgentRecord } from '../../../src/session/ActiveAgentRegistry.js';

const dirs: string[] = [];
afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => fse.remove(dir)));
});

async function registryDir(): Promise<string> {
  const dir = await fse.mkdtemp(path.join(os.tmpdir(), 'autohand-peers-'));
  dirs.push(dir);
  return dir;
}

function record(sessionId: string, workspaceRoot: string): ActiveAgentRecord {
  return {
    version: 1, pid: process.pid, sessionId, workspaceRoot,
    projectName: 'repo', provider: 'openrouter', model: 'claude',
    mode: 'interactive', status: 'working',
    startedAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
    messageCount: 1, contextPercent: 99, tokensUsed: 0,
    activity: { phase: 'editing', pathsWritten: ['src/a.ts'] },
  };
}

describe('PeerAwarenessManager', () => {
  it('excludes this session and other workspaces', async () => {
    const dir = await registryDir();
    const registry = new ActiveAgentRegistry(dir);
    await registry.write(record('me', '/repo'));
    await registry.write(record('peer', '/repo'));
    await registry.write(record('elsewhere', '/other'));

    const manager = new PeerAwarenessManager({
      workspaceRoot: '/repo', sessionId: 'me', tier: 'warn', registry,
    });
    await manager.refresh();

    expect(manager.getPeers().map((p) => p.sessionId)).toEqual(['peer']);
  });

  it('reports joins and leaves between refreshes', async () => {
    const dir = await registryDir();
    const registry = new ActiveAgentRegistry(dir);
    const manager = new PeerAwarenessManager({
      workspaceRoot: '/repo', sessionId: 'me', tier: 'warn', registry,
    });

    await registry.write(record('peer', '/repo'));
    expect((await manager.refresh()).joined.map((p) => p.sessionId)).toEqual(['peer']);

    await registry.remove('peer');
    expect((await manager.refresh()).left.map((p) => p.sessionId)).toEqual(['peer']);
  });

  it('warns on drift only after a baseline exists, and not for its own git work', async () => {
    const dir = await registryDir();
    const registry = new ActiveAgentRegistry(dir);
    let sha = 'aaa';
    const manager = new PeerAwarenessManager({
      workspaceRoot: '/repo', sessionId: 'me', tier: 'warn', registry,
      readHead: async () => ({ branch: 'main', sha }),
    });

    expect((await manager.refresh()).warnings).toEqual([]);

    sha = 'bbb';
    expect((await manager.refresh()).warnings.map((w) => w.kind)).toEqual(['repo-drift']);

    sha = 'ccc';
    await manager.adoptRepoBaseline();
    expect((await manager.refresh()).warnings).toEqual([]);
  });

  it('warns on a colliding write and stays quiet otherwise', async () => {
    const dir = await registryDir();
    const registry = new ActiveAgentRegistry(dir);
    await registry.write(record('peer', '/repo'));
    const manager = new PeerAwarenessManager({
      workspaceRoot: '/repo', sessionId: 'me', tier: 'warn', registry,
    });
    await manager.refresh();

    expect(manager.warnForWrite('src/a.ts').map((w) => w.kind)).toEqual(['file-collision']);
    expect(manager.warnForWrite('src/b.ts')).toEqual([]);
    expect(manager.warnForCommand('git commit -m x').map((w) => w.kind)).toEqual(['git-mutation']);
    expect(manager.warnForCommand('git status')).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun run test -- tests/session/peers/PeerAwarenessManager.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Write minimal implementation**

```ts
/**
 * @license
 * Copyright 2026 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { ActiveAgentRegistry, type ActiveAgentRecord } from '../ActiveAgentRegistry.js';
import { readRepoHead, type RepoHead } from './RepoStateReader.js';
import {
  warnForFileWrite,
  warnForGitMutation,
  warnForRepoDrift,
  type AwarenessTier,
  type PeerWarning,
} from './PeerWarnings.js';

export interface PeerAwarenessManagerOptions {
  workspaceRoot: string;
  sessionId: string;
  tier: AwarenessTier;
  registry?: ActiveAgentRegistry;
  readHead?: (workspaceRoot: string) => Promise<RepoHead | null>;
}

export interface PeerRefresh {
  joined: ActiveAgentRecord[];
  left: ActiveAgentRecord[];
  warnings: PeerWarning[];
}

export class PeerAwarenessManager {
  private readonly registry: ActiveAgentRegistry;
  private readonly readHead: (workspaceRoot: string) => Promise<RepoHead | null>;
  private peers: ActiveAgentRecord[] = [];
  private baseline: RepoHead | null = null;
  /** Path -> mtime when this session last read it, for collision detection. */
  private readonly readCache = new Map<string, number>();

  constructor(private readonly options: PeerAwarenessManagerOptions) {
    this.registry = options.registry ?? new ActiveAgentRegistry();
    this.readHead = options.readHead ?? readRepoHead;
  }

  getPeers(): ActiveAgentRecord[] {
    return [...this.peers];
  }

  recordRead(relativePath: string, mtimeMs: number): void {
    this.readCache.set(relativePath, mtimeMs);
  }

  getReadMtime(relativePath: string): number | undefined {
    return this.readCache.get(relativePath);
  }

  /** Re-reads .git and adopts the result, so this session's own commits never warn. */
  async adoptRepoBaseline(): Promise<void> {
    this.baseline = await this.readHead(this.options.workspaceRoot);
  }

  async refresh(): Promise<PeerRefresh> {
    const all = await this.registry.listActive();
    const next = all.filter((record) =>
      record.sessionId !== this.options.sessionId
      && record.workspaceRoot === this.options.workspaceRoot);

    const previousIds = new Set(this.peers.map((p) => p.sessionId));
    const nextIds = new Set(next.map((p) => p.sessionId));
    const joined = next.filter((p) => !previousIds.has(p.sessionId));
    const left = this.peers.filter((p) => !nextIds.has(p.sessionId));
    this.peers = next;

    const current = await this.readHead(this.options.workspaceRoot);
    const warnings = warnForRepoDrift(this.options.tier, this.baseline, current, next);
    this.baseline = current;

    return { joined, left, warnings };
  }

  warnForWrite(relativePath: string): PeerWarning[] {
    return warnForFileWrite(this.options.tier, relativePath, this.peers);
  }

  warnForCommand(command: string): PeerWarning[] {
    return warnForGitMutation(this.options.tier, command, this.peers);
  }
}
```

And `src/session/peers/index.ts`:

```ts
/**
 * @license
 * Copyright 2026 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
export { readRepoHead, type RepoHead } from './RepoStateReader.js';
export {
  isGitMutationCommand,
  warnForFileWrite,
  warnForGitMutation,
  warnForRepoDrift,
  type AwarenessTier,
  type PeerWarning,
} from './PeerWarnings.js';
export { buildActivity, derivePhase, type ActivityInput } from './PeerActivityPublisher.js';
export {
  PeerAwarenessManager,
  type PeerAwarenessManagerOptions,
  type PeerRefresh,
} from './PeerAwarenessManager.js';
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun run test -- tests/session/peers/PeerAwarenessManager.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/session/peers/PeerAwarenessManager.ts src/session/peers/index.ts tests/session/peers/PeerAwarenessManager.test.ts
git commit -m "$(cat <<'EOF'
Track peer sessions and repository drift in one manager

Give the agent a single surface for peer state: workspace-scoped peer
lists, join and leave diffing, and a drift baseline that this session
re-adopts after its own git work so it never warns about itself.

Co-authored-by: Autohand Evolve <code-noreply@autohand.ai>
EOF
)"
```

---

### Task 6: Configuration and settings entry

**Files:**
- Modify: `src/types.ts` (add `SessionsSettings`), `src/commands/settings.ts` (registry entry), `src/i18n/locales/en.json`
- Test: `tests/commands/settings.test.ts`

**Interfaces:**
- Consumes: `AwarenessTier` (Task 3).
- Produces: `config.sessions?.awareness?: AwarenessTier`, default `'warn'`, resolved by `export function resolveAwarenessTier(config: LoadedConfig): AwarenessTier` exported from `src/session/peers/PeerWarnings.ts`.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from 'vitest';
import { SETTINGS_REGISTRY } from '../../src/commands/settings.js';
import { resolveAwarenessTier } from '../../src/session/peers/PeerWarnings.js';
import type { LoadedConfig } from '../../src/types.js';

function config(awareness?: string): LoadedConfig {
  return { configPath: '/tmp/c.json', provider: 'openrouter',
    ...(awareness ? { sessions: { awareness } } : {}) } as LoadedConfig;
}

describe('sessions.awareness setting', () => {
  it('is registered as an enum defaulting to warn', () => {
    const setting = SETTINGS_REGISTRY.find((s) => s.key === 'sessions.awareness');
    expect(setting).toBeDefined();
    expect(setting?.type).toBe('enum');
    expect(setting?.enumValues).toEqual(['passive', 'warn', 'coordinate']);
    expect(setting?.defaultValue).toBe('warn');
  });

  it('resolves configured and default tiers, rejecting unknown values', () => {
    expect(resolveAwarenessTier(config())).toBe('warn');
    expect(resolveAwarenessTier(config('passive'))).toBe('passive');
    expect(resolveAwarenessTier(config('coordinate'))).toBe('coordinate');
    expect(resolveAwarenessTier(config('nonsense'))).toBe('warn');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun run test -- tests/commands/settings.test.ts`
Expected: FAIL — `resolveAwarenessTier` is not exported; setting not found

- [ ] **Step 3: Write minimal implementation**

Add to `src/types.ts` near the other settings interfaces:

```ts
export interface SessionsSettings {
  /** How this session reacts to other sessions in the same workspace. */
  awareness?: 'passive' | 'warn' | 'coordinate';
}
```

and on `LoadedConfig`: `sessions?: SessionsSettings;`

Append to `src/session/peers/PeerWarnings.ts`:

```ts
import type { LoadedConfig } from '../../types.js';

const AWARENESS_TIERS: AwarenessTier[] = ['passive', 'warn', 'coordinate'];

export function resolveAwarenessTier(config: LoadedConfig): AwarenessTier {
  const configured = config.sessions?.awareness;
  return AWARENESS_TIERS.includes(configured as AwarenessTier)
    ? configured as AwarenessTier
    : 'warn';
}
```

Add a `sessions` category to `SETTING_CATEGORIES` in `src/commands/settings.ts` and this entry to `SETTINGS_REGISTRY`:

```ts
  { key: 'sessions.awareness', labelKey: 'commands.settings.sessions.awareness', descriptionKey: 'commands.settings.sessions.awarenessDesc', category: 'sessions', type: 'enum', enumValues: ['passive', 'warn', 'coordinate'], defaultValue: 'warn' },
```

Add to `src/i18n/locales/en.json` under `commands.settings`:

```json
"sessions": {
  "awareness": "Concurrent session awareness",
  "awarenessDesc": "How this session reacts when others are open in the same project: passive shows them, warn also flags risky moments, coordinate asks before writing files another session claimed"
}
```

and under `commands.settings.categories`: `"sessions": "Sessions"`.

- [ ] **Step 4: Run test to verify it passes**

Run: `bun run test -- tests/commands/settings.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/types.ts src/commands/settings.ts src/i18n/locales/en.json src/session/peers/PeerWarnings.ts tests/commands/settings.test.ts
git commit -m "$(cat <<'EOF'
Expose the session awareness tier as a setting

Register sessions.awareness in the settings registry so it appears in
/settings, and resolve unknown values to the warn default.

Co-authored-by: Autohand Evolve <code-noreply@autohand.ai>
EOF
)"
```

---

### Task 7: Publish activity from the heartbeat

**Files:**
- Modify: `src/session/ActiveAgentRegistry.ts:109-115` (heartbeat options), `:138-172` (update)
- Modify: `src/core/agent.ts:2389-2415` (construct heartbeat)
- Test: `tests/session/ActiveAgentRegistry.test.ts`

**Interfaces:**
- Consumes: `buildActivity`, `ActivityInput` (Task 4).
- Produces: `ActiveAgentHeartbeatOptions.getActivity?: () => ActiveAgentActivity | undefined`.

- [ ] **Step 1: Write the failing test**

```ts
it('writes the activity block supplied by the host', async () => {
  const dir = await fse.mkdtemp(path.join(os.tmpdir(), 'autohand-hb-'));
  const registry = new ActiveAgentRegistry(dir);
  const heartbeat = new ActiveAgentHeartbeat(registry, {
    runtime: fakeRuntime(),
    getProvider: () => 'openrouter',
    getSession: () => fakeSession(),
    getStatusSnapshot: () => fakeSnapshot(),
    getActivity: () => ({ phase: 'editing', pathsWritten: ['src/a.ts'] }),
  });

  await heartbeat.update('working');
  const [loaded] = await registry.listActive();

  expect(loaded?.activity).toEqual({ phase: 'editing', pathsWritten: ['src/a.ts'] });
  await heartbeat.stop();
  await fse.remove(dir);
});
```

Reuse the existing `fakeRuntime` / `fakeSession` / `fakeSnapshot` helpers in that file; if absent, add them alongside `baseRecord()` from Task 2.

- [ ] **Step 2: Run test to verify it fails**

Run: `bun run test -- tests/session/ActiveAgentRegistry.test.ts`
Expected: FAIL — `getActivity` is not a valid option; `loaded.activity` is undefined

- [ ] **Step 3: Write minimal implementation**

In `ActiveAgentHeartbeatOptions` add:

```ts
  getActivity?: () => ActiveAgentActivity | undefined;
```

In `ActiveAgentHeartbeat.update`, inside the `writeUpdate({...})` object literal, add as the final property:

```ts
        ...(this.options.getActivity?.() ? { activity: this.options.getActivity()! } : {}),
```

In `src/core/agent.ts`, extend the `ActiveAgentHeartbeat` construction with:

```ts
        getActivity: () => buildActivity({
          isInstructionActive: this.isInstructionActive,
          awaitingInput: this.awaitingUserInput === true,
          activeTool: this.currentToolName,
          instruction: this.currentInstructionText,
          command: this.currentCommandText,
          pathsWritten: this.peerPathsWritten,
          headRef: this.peerAwareness?.getRepoBaseline() ?? null,
          claims: this.peerClaims,
        }),
```

Add the backing fields to `AutohandAgent` near `filesModifiedThisSession` (`agent.ts:416`):

```ts
  private currentToolName?: string;
  private currentInstructionText?: string;
  private currentCommandText?: string;
  private awaitingUserInput = false;
  private peerPathsWritten: string[] = [];
  private peerClaims: string[] = [];
```

Add `getRepoBaseline(): RepoHead | null { return this.baseline; }` to `PeerAwarenessManager`.

- [ ] **Step 4: Run test to verify it passes**

Run: `bun run test -- tests/session/ActiveAgentRegistry.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/session/ActiveAgentRegistry.ts src/core/agent.ts src/session/peers/PeerAwarenessManager.ts tests/session/ActiveAgentRegistry.test.ts
git commit -m "$(cat <<'EOF'
Publish activity on the existing heartbeat tick

Feed the activity block through the heartbeat the registry already runs
every five seconds rather than adding a second timer.

Co-authored-by: Autohand Evolve <code-noreply@autohand.ai>
EOF
)"
```

---

### Task 8: Git guard and collision detection in ActionExecutor

**Files:**
- Modify: `src/core/actionExecutor.ts:756-767` (`notifyFileModified`), `:1407` (`run_command` case), `:1605` (`shell` case), and `AgentExecutorDeps`
- Test: `tests/core/actionExecutor.peerAwareness.test.ts`

**Interfaces:**
- Consumes: `PeerAwarenessManager` (Task 5).
- Produces: `AgentExecutorDeps.peerAwareness?: Pick<PeerAwarenessManager, 'warnForWrite' | 'warnForCommand' | 'adoptRepoBaseline'>` and `AgentExecutorDeps.onPeerWarning?: (warning: PeerWarning) => void`.

- [ ] **Step 1: Write the failing test**

```ts
/**
 * @license
 * Copyright 2026 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, expect, it, vi } from 'vitest';
import type { PeerWarning } from '../../src/session/peers/index.js';

describe('ActionExecutor peer awareness', () => {
  it('emits a git-mutation warning before running a git mutation', async () => {
    const warnings: PeerWarning[] = [];
    const executor = createExecutorForTest({
      peerAwareness: {
        warnForCommand: (command: string) => command.includes('commit')
          ? [{ kind: 'git-mutation' as const, message: 'peer active' }]
          : [],
        warnForWrite: () => [],
        adoptRepoBaseline: vi.fn(async () => {}),
      },
      onPeerWarning: (warning: PeerWarning) => warnings.push(warning),
    });

    await executor.execute({ type: 'run_command', command: 'git commit -m x' });

    expect(warnings.map((w) => w.kind)).toEqual(['git-mutation']);
  });

  it('adopts a fresh repo baseline after its own git mutation', async () => {
    const adoptRepoBaseline = vi.fn(async () => {});
    const executor = createExecutorForTest({
      peerAwareness: { warnForCommand: () => [], warnForWrite: () => [], adoptRepoBaseline },
      onPeerWarning: () => {},
    });

    await executor.execute({ type: 'run_command', command: 'git commit -m x' });

    expect(adoptRepoBaseline).toHaveBeenCalledTimes(1);
  });

  it('emits a file-collision warning when a peer wrote the same path', async () => {
    const warnings: PeerWarning[] = [];
    const executor = createExecutorForTest({
      peerAwareness: {
        warnForCommand: () => [],
        warnForWrite: (p: string) => p === 'src/a.ts'
          ? [{ kind: 'file-collision' as const, message: 'peer wrote src/a.ts' }]
          : [],
        adoptRepoBaseline: vi.fn(async () => {}),
      },
      onPeerWarning: (warning: PeerWarning) => warnings.push(warning),
    });

    await executor.execute({ type: 'write_file', path: 'src/a.ts', content: 'x' });

    expect(warnings.map((w) => w.kind)).toEqual(['file-collision']);
  });
});
```

Add a `createExecutorForTest(deps)` helper mirroring the construction used by the existing `tests/core/actionExecutor*.test.ts` files, spreading the supplied `deps` over the standard fixture deps.

- [ ] **Step 2: Run test to verify it fails**

Run: `bun run test -- tests/core/actionExecutor.peerAwareness.test.ts`
Expected: FAIL — `peerAwareness` is not a recognised dep; no warnings emitted

- [ ] **Step 3: Write minimal implementation**

Add to `AgentExecutorDeps` (near `backgroundProcessRegistry`, `actionExecutor.ts:203`):

```ts
  /** Peer session awareness, when other sessions may share this workspace. */
  peerAwareness?: {
    warnForWrite(relativePath: string): PeerWarning[];
    warnForCommand(command: string): PeerWarning[];
    adoptRepoBaseline(): Promise<void>;
  };
  onPeerWarning?: (warning: PeerWarning) => void;
```

Store both in the constructor alongside `this.backgroundProcessRegistry`.

Add a private helper:

```ts
  private emitPeerWarnings(warnings: PeerWarning[]): void {
    for (const warning of warnings) {
      this.onPeerWarning?.(warning);
    }
  }
```

In `notifyFileModified`, before the existing body:

```ts
    this.emitPeerWarnings(
      this.peerAwareness?.warnForWrite(this.toWorkspaceRelative(filePath)) ?? [],
    );
```

where `toWorkspaceRelative` is `path.relative(this.runtime.workspaceRoot, path.resolve(this.runtime.workspaceRoot, filePath))`.

In both the `run_command` case (`:1407`) and the `shell` case (`:1605`), immediately after `cmdStr` is computed:

```ts
        this.emitPeerWarnings(this.peerAwareness?.warnForCommand(cmdStr) ?? []);
```

and after the command completes, in each path:

```ts
        if (this.peerAwareness && isGitMutationCommand(cmdStr)) {
          void this.peerAwareness.adoptRepoBaseline().catch(() => {});
        }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun run test -- tests/core/actionExecutor.peerAwareness.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/core/actionExecutor.ts tests/core/actionExecutor.peerAwareness.test.ts
git commit -m "$(cat <<'EOF'
Warn about concurrent sessions at the write and command choke points

Flag git mutations and colliding file writes while another session is
active in the same workspace, and re-adopt the repository baseline after
this session's own git work so it never warns about itself.

Co-authored-by: Autohand Evolve <code-noreply@autohand.ai>
EOF
)"
```

---

### Task 9: Wire the manager into the agent and surface peers in the UI

**Files:**
- Modify: `src/core/agent.ts` (construct manager, refresh on heartbeat, route warnings)
- Modify: `src/core/agent/AgentDependencyComposer.ts` (pass deps to the executor)
- Modify: `src/core/agent/AgentUIRuntime.ts:626-633` (status segment)
- Modify: `src/index.ts:1795` (launch line, inside `printWelcome`)
- Test: `tests/ui/ink/peerStatusSegment.test.tsx`

**Interfaces:**
- Consumes: `PeerAwarenessManager` (Task 5), `resolveAwarenessTier` (Task 6).
- Produces: `export function buildPeerLineExtension(peerCount: number): LineExtension | undefined` in `src/core/agent/AgentUIRuntime.ts`.

- [ ] **Step 1: Write the failing test**

```ts
/**
 * @license
 * Copyright 2026 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, expect, it } from 'vitest';
import { buildPeerLineExtension } from '../../../src/core/agent/AgentUIRuntime.js';

describe('buildPeerLineExtension', () => {
  it('renders nothing with no peers', () => {
    expect(buildPeerLineExtension(0)).toBeUndefined();
  });

  it('renders a singular and plural peer segment', () => {
    expect(buildPeerLineExtension(1)?.segments?.[0]?.text).toContain('1 peer');
    expect(buildPeerLineExtension(3)?.segments?.[0]?.text).toContain('3 peers');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun run test -- tests/ui/ink/peerStatusSegment.test.tsx`
Expected: FAIL — `buildPeerLineExtension` is not exported

- [ ] **Step 3: Write minimal implementation**

Add to `src/core/agent/AgentUIRuntime.ts`:

```ts
export function buildPeerLineExtension(peerCount: number): LineExtension | undefined {
  if (peerCount <= 0) {
    return undefined;
  }
  return {
    segments: [{
      id: 'session-peers',
      text: `⚉ ${peerCount} ${peerCount === 1 ? 'peer' : 'peers'}`,
      color: 'warning',
    }],
  };
}
```

Merge it into the status extension already built at `AgentUIRuntime.ts:626` via `mergeLineExtensions`.

In `src/core/agent.ts`, construct the manager where `sessionDiffStatsTracker` is created (`agent.ts:458`):

```ts
    this.peerAwareness = new PeerAwarenessManager({
      workspaceRoot: runtime.workspaceRoot,
      sessionId: this.sessionManager.getCurrentSession()?.metadata.sessionId ?? String(process.pid),
      tier: resolveAwarenessTier(runtime.config),
    });
```

In `updateActiveAgentHeartbeat`, after the existing `update` call:

```ts
    const refresh = await this.peerAwareness.refresh().catch(() => null);
    for (const warning of refresh?.warnings ?? []) {
      this.inkRenderer?.addNotification(warning.message);
    }
    for (const peer of refresh?.joined ?? []) {
      this.inkRenderer?.addNotification(
        `Another session joined this project (${peer.model}, ${peer.activity?.phase ?? 'idle'}).`,
      );
    }
    this.syncProviderModelStatusLine?.();
```

In `AgentDependencyComposer`, pass to the executor deps:

```ts
      peerAwareness: host.peerAwareness,
      onPeerWarning: (warning) => host.inkRenderer?.addNotification(warning.message),
```

In `src/index.ts`, inside `printWelcome` after the announcement block:

```ts
  const peerCount = peerAwareness?.getPeers().length ?? 0;
  if (peerCount > 0) {
    console.log(formatPeerSessionsLine(peerCount));
    console.log();
  }
```

with `formatPeerSessionsLine` added to `src/ui/theme/startup.ts` alongside the other `formatWelcome*` helpers, and its string sourced from `t('sessions.peersActive', { count })`.

- [ ] **Step 4: Run test to verify it passes**

Run: `bun run test -- tests/ui/ink/peerStatusSegment.test.tsx`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/core/agent.ts src/core/agent/AgentDependencyComposer.ts src/core/agent/AgentUIRuntime.ts src/index.ts src/ui/theme/startup.ts src/i18n/locales/en.json tests/ui/ink/peerStatusSegment.test.tsx
git commit -m "$(cat <<'EOF'
Surface peer sessions at launch and in the status line

Wire peer awareness through the agent so warnings reach the notification
stack, the composer status line carries a peer count, and the welcome
block reports other sessions already working in the project.

Co-authored-by: Autohand Evolve <code-noreply@autohand.ai>
EOF
)"
```

---

### Task 10: Coordinate tier claims

**Files:**
- Modify: `src/session/peers/PeerWarnings.ts` (claim conflicts), `src/session/peers/PeerAwarenessManager.ts` (claim state)
- Modify: `src/core/actionExecutor.ts` (confirmation before a claimed write)
- Test: `tests/session/peers/PeerClaims.test.ts`

**Interfaces:**
- Consumes: `AwarenessTier`, `PeerWarning` (Task 3).
- Produces: `export function warnForClaimConflict(tier, relativePath, peers): PeerWarning[]`; `PeerAwarenessManager.claim(relativePath: string): void`; `PeerAwarenessManager.getClaims(): string[]`.

- [ ] **Step 1: Write the failing test**

```ts
/**
 * @license
 * Copyright 2026 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, expect, it } from 'vitest';
import { warnForClaimConflict } from '../../../src/session/peers/PeerWarnings.js';
import type { ActiveAgentRecord } from '../../../src/session/ActiveAgentRegistry.js';

function claimingPeer(claims: string[]): ActiveAgentRecord {
  return {
    version: 1, pid: 4242, sessionId: 'peer', workspaceRoot: '/repo',
    projectName: 'repo', provider: 'openrouter', model: 'claude',
    mode: 'interactive', status: 'working',
    startedAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
    messageCount: 1, contextPercent: 90, tokensUsed: 0,
    activity: { phase: 'editing', pathsWritten: [], claims },
  };
}

describe('warnForClaimConflict', () => {
  it('conflicts only in the coordinate tier', () => {
    const peers = [claimingPeer(['src/a.ts'])];
    expect(warnForClaimConflict('coordinate', 'src/a.ts', peers).map((w) => w.kind))
      .toEqual(['claim-conflict']);
    expect(warnForClaimConflict('warn', 'src/a.ts', peers)).toEqual([]);
    expect(warnForClaimConflict('passive', 'src/a.ts', peers)).toEqual([]);
  });

  it('ignores unclaimed paths', () => {
    expect(warnForClaimConflict('coordinate', 'src/b.ts', [claimingPeer(['src/a.ts'])])).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun run test -- tests/session/peers/PeerClaims.test.ts`
Expected: FAIL — `warnForClaimConflict` is not exported

- [ ] **Step 3: Write minimal implementation**

Append to `src/session/peers/PeerWarnings.ts`:

```ts
export function warnForClaimConflict(
  tier: AwarenessTier,
  relativePath: string,
  peers: ActiveAgentRecord[],
): PeerWarning[] {
  if (tier !== 'coordinate') {
    return [];
  }
  const holders = peers.filter((p) => p.activity?.claims?.includes(relativePath));
  if (holders.length === 0) {
    return [];
  }
  return [{
    kind: 'claim-conflict',
    message: `${relativePath} is claimed by another session. Confirm before overwriting it.`,
  }];
}
```

Add to `PeerAwarenessManager`:

```ts
  private readonly claims = new Set<string>();

  claim(relativePath: string): void {
    this.claims.add(relativePath);
  }

  getClaims(): string[] {
    return [...this.claims];
  }
```

and include claim conflicts in `warnForWrite`:

```ts
  warnForWrite(relativePath: string): PeerWarning[] {
    this.claim(relativePath);
    return [
      ...warnForFileWrite(this.options.tier, relativePath, this.peers),
      ...warnForClaimConflict(this.options.tier, relativePath, this.peers),
    ];
  }
```

In `ActionExecutor`, when a `claim-conflict` warning is produced and `this.confirmAction` exists, request confirmation before proceeding with the write; under `--yes` / autoConfirm, proceed and still emit the warning.

- [ ] **Step 4: Run test to verify it passes**

Run: `bun run test -- tests/session/peers/PeerClaims.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/session/peers/PeerWarnings.ts src/session/peers/PeerAwarenessManager.ts src/core/actionExecutor.ts tests/session/peers/PeerClaims.test.ts
git commit -m "$(cat <<'EOF'
Add opt-in claims for the coordinate awareness tier

Let a session claim the paths it writes and ask for confirmation before
overwriting a path another session claimed. Claims live in the heartbeat
record, so a crashed session releases them through the existing
staleness pruning.

Co-authored-by: Autohand Evolve <code-noreply@autohand.ai>
EOF
)"
```

---

### Task 11: Two-session Tuistory scenario

**Files:**
- Create: `tests/tuistory/session-awareness.tuistory.test.ts`

**Interfaces:**
- Consumes: the whole feature.
- Produces: nothing.

- [ ] **Step 1: Write the failing test**

```ts
/**
 * @license
 * Copyright 2026 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, expect, it } from 'vitest';

describe('session awareness Tuistory', () => {
  it('reports a peer once a second session opens the same workspace', async () => {
    const state = await createTempAutohandHome({ config: { ui: { promptSuggestions: false } } });
    tempStates.push(state);

    const first = await trackSession(launchBuiltAutohand(
      ['--path', state.workspaceRoot, '--config', state.configPath, '--y'],
      { autohandHome: state.autohandHome, cwd: state.workspaceRoot },
    ));
    await waitForComposer(first);

    const second = await trackSession(launchBuiltAutohand(
      ['--path', state.workspaceRoot, '--config', state.configPath, '--y'],
      { autohandHome: state.autohandHome, cwd: state.workspaceRoot },
    ));
    await waitForComposer(second);

    // Both sessions share AUTOHAND_HOME, so they share the active-agent registry.
    await waitForTerminalText(second, '1 peer', { timeout: 30_000 });
    expect(second.readAll()).toContain('peer');
  });
});
```

Mirror the imports, `tempStates`, `trackSession`, `waitForComposer`, `createTempAutohandHome`, and `launchBuiltAutohand` usage from `tests/tuistory/built-cli.tuistory.test.ts`.

- [ ] **Step 2: Run test to verify it fails**

Run: `bun run proof:build-tuistory`
Expected: FAIL — the second session reports no peer

- [ ] **Step 3: Write minimal implementation**

No new production code. If the test fails, the defect is in Task 9's wiring — most likely the peer refresh not running before the first status render. Fix by calling `peerAwareness.refresh()` once during `initializeAgentUI` before the first `syncProviderModelStatusLine`.

- [ ] **Step 4: Run test to verify it passes**

Run: `bun run proof:build-tuistory`
Expected: PASS

- [ ] **Step 5: Run full proof and commit**

```bash
bun run proof
git add tests/tuistory/session-awareness.tuistory.test.ts src/core/agent/AgentUIRuntime.ts
git commit -m "$(cat <<'EOF'
Cover concurrent session awareness end to end

Launch two built CLIs against one workspace and assert the second
reports the first through the shared active-agent registry.

Co-authored-by: Autohand Evolve <code-noreply@autohand.ai>
EOF
)"
```

---

## Self-review

**Spec coverage.** Registry extension → Task 2. Permissions and sanitization (Security) → Tasks 2 and 4. Tier config → Task 6. Git guard, file collision, repo drift → Tasks 3, 5, 8. `phase` derivation → Task 4. Drift attribution → Tasks 5 and 8. Claims → Task 10. Launch line, status segment, notifications → Task 9. Two-session Tuistory → Task 11. Every spec section maps to a task.

**Known gap, deliberately deferred.** The spec lists richer `/agents` output (`src/commands/agents.ts`). It is display-only and depends on nothing else, so it is intentionally not a task here; add it as a follow-up once the record shape has settled in practice.

**Type consistency.** `AwarenessTier`, `PeerWarning`, `ActiveAgentActivity`, `ActiveAgentPhase`, `RepoHead`, and `ActivityInput` are each defined once and referenced by the same name throughout. `warnForWrite` / `warnForCommand` / `adoptRepoBaseline` keep identical signatures in Tasks 5, 8, and 10.
