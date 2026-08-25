/**
 * @license
 * Copyright 2026 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, expect, it } from 'vitest';
import type { ActiveAgentRecord } from '../../../src/session/ActiveAgentRegistry.js';
import { formatPeerCards } from '../../../src/session/peers/PeerFormatter.js';

function record(overrides: Partial<ActiveAgentRecord> = {}): ActiveAgentRecord {
  return {
    version: 1,
    pid: 4242,
    sessionId: 'peer-1',
    workspaceRoot: '/repo',
    projectName: 'repo',
    provider: 'openrouter',
    model: 'anthropic/claude-sonnet-4',
    mode: 'interactive',
    status: 'working',
    startedAt: '2026-07-27T10:00:00.000Z',
    updatedAt: '2026-07-27T10:05:00.000Z',
    messageCount: 3,
    contextPercent: 42,
    tokensUsed: 1234,
    activity: {
      phase: 'editing',
      instruction: 'Refactor the auth module',
      command: 'bun test',
      pathsWritten: ['src/auth/login.ts', 'src/auth/session.ts'],
      claims: ['src/auth/login.ts'],
      headRef: { branch: 'feature/auth', sha: 'abcdef1234567890abcdef1234567890abcd1234' },
    },
    ...overrides,
  };
}

describe('formatPeerCards', () => {
  it('renders an empty state when no peers are active', () => {
    const output = formatPeerCards([]);

    expect(output).toContain('No active peers in this workspace.');
  });

  it('renders identity, runtime, and activity details for a single peer', () => {
    const output = formatPeerCards([record()]);

    expect(output).toContain('Peer: peer-1');
    expect(output).toContain('Model:      anthropic/claude-sonnet-4');
    expect(output).toContain('Provider:   openrouter');
    expect(output).toContain('Mode:       interactive');
    expect(output).toContain('Status:     working');
    expect(output).toContain('Context:    42%');
    expect(output).toContain('Phase:      editing');
    expect(output).toContain('Instruction: Refactor the auth module');
    expect(output).toContain('Command:    bun test');
    expect(output).toContain('Head:       feature/auth (abcdef1)');
    expect(output).toContain('• src/auth/login.ts');
    expect(output).toContain('• src/auth/session.ts');
    expect(output).toContain('Claims:');
    expect(output).toContain('• src/auth/login.ts');
  });

  it('renders one card per peer when multiple peers are active', () => {
    const output = formatPeerCards([
      record(),
      record({ sessionId: 'peer-2', model: 'google/gemini-flash', status: 'idle' }),
    ]);

    expect(output).toContain('Peer: peer-1');
    expect(output).toContain('Peer: peer-2');
    expect(output).toContain('Model:      anthropic/claude-sonnet-4');
    expect(output).toContain('Model:      google/gemini-flash');
    expect(output).toContain('Status:     idle');
  });

  it('renders a placeholder when the peer has no activity data', () => {
    const output = formatPeerCards([record({ activity: undefined })]);

    expect(output).toContain('Peer: peer-1');
    expect(output).toContain('(no activity data)');
    expect(output).not.toContain('Phase:');
    expect(output).not.toContain('Paths written:');
  });

  it('omits optional activity fields when they are absent', () => {
    const output = formatPeerCards([record({
      activity: {
        phase: 'running_command',
        pathsWritten: [],
      },
    })]);

    expect(output).toContain('Phase:      running_command');
    expect(output).not.toContain('Instruction:');
    expect(output).not.toContain('Command:');
    expect(output).not.toContain('Claims:');
    expect(output).toContain('none');
  });

  it('renders unknown and detached head refs', () => {
    const withoutHead = formatPeerCards([record({
      activity: { phase: 'idle', pathsWritten: [] },
    })]);
    expect(withoutHead).toContain('Head:       unknown');

    const detached = formatPeerCards([record({
      activity: {
        phase: 'idle',
        pathsWritten: [],
        headRef: { branch: null, sha: '1234567890abcdef' },
      },
    })]);
    expect(detached).toContain('Head:       detached (1234567)');
  });

  it('truncates long path and claim lists', () => {
    const paths = Array.from({ length: 14 }, (_, index) => `src/file-${index}.ts`);
    const output = formatPeerCards(
      [record({ activity: { phase: 'editing', pathsWritten: paths, claims: paths } })],
      { maxPaths: 3, maxClaims: 2 },
    );

    expect(output).toContain('• src/file-0.ts');
    expect(output).toContain('• src/file-2.ts');
    expect(output).not.toContain('• src/file-3.ts');
    expect(output).toContain('… and 11 more');
    expect(output).toContain('… and 12 more');
  });
});
