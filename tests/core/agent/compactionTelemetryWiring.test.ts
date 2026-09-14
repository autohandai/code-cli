/**
 * @license
 * Copyright 2026 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 *
 * The orchestrator can report a compaction and reconcile skill spans, but only
 * if the agent hands it the telemetry manager and the registry. Both are built
 * after the orchestrator, so the wiring has to resolve them lazily, and a lazy
 * binding that silently resolves to nothing looks exactly like a session where
 * no compaction ever happened.
 */
import { describe, expect, it, vi } from 'vitest';
import { AutohandAgent } from '../../../src/core/agent.js';
import type { FileActionManager } from '../../../src/actions/filesystem.js';
import type { AgentRuntime, LLMProvider } from '../../../src/types.js';

interface AgentInternals {
  conversation: {
    reset(systemPrompt: string): void;
    addMessage(message: { role: 'user' | 'assistant'; content: string }): void;
  };
  skillsRegistry: { noteContextCompaction(): string[] };
  telemetryManager: { trackContextCompaction: unknown };
  contextOrchestrator: {
    setContextWindow(window?: number): void;
    handleOverflow(tools: unknown[]): Promise<unknown>;
  };
}

function createAgent(): AgentInternals {
  const llm = {
    generate: vi.fn(),
    generateStream: vi.fn(),
    getModel: vi.fn().mockReturnValue('test-model'),
  } as unknown as LLMProvider;
  const files = {
    root: '/test/workspace',
    readFile: vi.fn().mockResolvedValue(''),
    writeFile: vi.fn(),
  } as unknown as FileActionManager;
  const runtime = {
    config: {
      provider: 'openrouter',
      openrouter: { model: 'test-model' },
      permissions: { mode: 'unrestricted' },
      ui: { useInkRenderer: false },
    },
    workspaceRoot: '/test/workspace',
    options: {},
  } as AgentRuntime;
  return new AutohandAgent(llm, files, runtime) as unknown as AgentInternals;
}

function fill(internals: AgentInternals): void {
  internals.conversation.reset('You are a helpful assistant');
  for (let i = 0; i < 40; i++) {
    internals.conversation.addMessage({ role: 'user', content: 'x'.repeat(2_000) });
    internals.conversation.addMessage({ role: 'assistant', content: 'y'.repeat(2_000) });
  }
}

describe('compaction telemetry wiring', () => {
  it('reports a compaction through the telemetry manager built after the orchestrator', async () => {
    const internals = createAgent();
    const trackContextCompaction = vi.fn(async () => {});
    internals.telemetryManager.trackContextCompaction = trackContextCompaction;
    fill(internals);

    internals.contextOrchestrator.setContextWindow(4_000);
    await internals.contextOrchestrator.handleOverflow([]);

    expect(trackContextCompaction).toHaveBeenCalledOnce();
    const [event] = trackContextCompaction.mock.calls[0] as [Record<string, unknown>];
    expect(event.tokensAfter as number).toBeLessThan(event.tokensBefore as number);
    expect(Array.isArray(event.survivingSpanIds)).toBe(true);
  });

  it('asks the skills registry which spans survived, so a compaction reconciles them', async () => {
    const internals = createAgent();
    internals.telemetryManager.trackContextCompaction = vi.fn(async () => {});
    const noteContextCompaction = vi.fn(() => ['span-from-registry']);
    internals.skillsRegistry.noteContextCompaction = noteContextCompaction;
    fill(internals);

    internals.contextOrchestrator.setContextWindow(4_000);
    await internals.contextOrchestrator.handleOverflow([]);

    expect(noteContextCompaction).toHaveBeenCalledOnce();
    const track = internals.telemetryManager.trackContextCompaction as ReturnType<typeof vi.fn>;
    expect((track.mock.calls[0][0] as Record<string, unknown>).survivingSpanIds)
      .toEqual(['span-from-registry']);
  });
});
