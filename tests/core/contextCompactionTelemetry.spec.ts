/**
 * @license
 * Copyright 2026 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 *
 * Every compaction path in the orchestrator has to report the same event, and
 * reconcile the skill spans at the same moment.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ConversationManager } from '../../src/core/conversationManager.js';
import { ContextOrchestrator } from '../../src/core/context/orchestrator.js';
import type { ContextCompactionData } from '../../src/telemetry/types.js';

describe('ContextOrchestrator compaction telemetry', () => {
  let conversationManager: ConversationManager;
  let trackContextCompaction: ReturnType<typeof vi.fn>;

  function makeOrchestrator(overrides: Record<string, unknown> = {}): ContextOrchestrator {
    return new ContextOrchestrator({
      model: 'openai/gpt-4o-mini',
      contextWindow: 4_000,
      conversationManager,
      enabled: false,
      telemetryManager: { trackContextCompaction } as never,
      getSurvivingSkillSpanIds: () => ['span-alive'],
      ...overrides,
    } as never);
  }

  function emitted(): ContextCompactionData[] {
    return trackContextCompaction.mock.calls.map((call) => call[0] as ContextCompactionData);
  }

  function fillConversation(): void {
    for (let i = 0; i < 40; i++) {
      conversationManager.addMessage({ role: 'user', content: 'x'.repeat(2_000) });
      conversationManager.addMessage({ role: 'assistant', content: 'y'.repeat(2_000) });
    }
  }

  beforeEach(() => {
    trackContextCompaction = vi.fn(async () => {});
    conversationManager = ConversationManager.getInstance();
    conversationManager.reset('You are a helpful assistant');
  });

  it('reports the measured before and after sizes of a compaction', async () => {
    fillConversation();

    await makeOrchestrator().handleOverflow([]);

    expect(trackContextCompaction).toHaveBeenCalled();
    const [event] = emitted();
    expect(event.tokensBefore).toBeGreaterThan(0);
    expect(event.tokensAfter).toBeGreaterThan(0);
    expect(event.tokensAfter).toBeLessThan(event.tokensBefore);
  });

  it('carries the spans still being sent after the compaction', async () => {
    fillConversation();

    await makeOrchestrator().handleOverflow([]);

    expect(emitted()[0].survivingSpanIds).toEqual(['span-alive']);
  });

  it('reports an empty survivor list when no skill span provider is wired', async () => {
    fillConversation();

    await makeOrchestrator({ getSurvivingSkillSpanIds: undefined }).handleOverflow([]);

    expect(emitted()[0].survivingSpanIds).toEqual([]);
  });

  it('reports nothing at all when the survivor list could not be determined', async () => {
    fillConversation();

    const orchestrator = makeOrchestrator({
      getSurvivingSkillSpanIds: () => {
        throw new Error('registry unavailable');
      },
    });
    await expect(orchestrator.handleOverflow([])).resolves.toBeDefined();

    // An empty list is a claim that nothing was carried. When the registry
    // could not answer, the honest report is no report: the two size figures
    // are not worth publishing a false survivor list to carry them.
    expect(trackContextCompaction).not.toHaveBeenCalled();
  });

  it('reports nothing when no compaction happened', async () => {
    conversationManager.addMessage({ role: 'user', content: 'short' });

    await makeOrchestrator().prepareRequest([]);

    expect(trackContextCompaction).not.toHaveBeenCalled();
  });

  it('never lets a telemetry failure break the compaction it is reporting', async () => {
    fillConversation();
    trackContextCompaction = vi.fn(async () => {
      throw new Error('telemetry endpoint unreachable');
    });

    await expect(makeOrchestrator().handleOverflow([])).resolves.toBeDefined();
  });
});
