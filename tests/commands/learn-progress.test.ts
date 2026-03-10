/**
 * @license
 * Copyright 2025 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 *
 * Tests for onProgress callback and sequential console.log progress
 * in the /learn command.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { learn } from '../../src/commands/learn.js';
import type { LLMProvider } from '../../src/providers/LLMProvider.js';

// ─── Mocks ──────────────────────────────────────────────────────────

vi.mock('../../src/skills/CommunitySkillsCache.js', () => ({
  CommunitySkillsCache: vi.fn().mockImplementation(() => ({
    getRegistry: vi.fn(async () => null),
    getRegistryIgnoreTTL: vi.fn(async () => null),
    setRegistry: vi.fn(async () => {}),
    getSkillDirectory: vi.fn(async () => null),
    setSkillDirectory: vi.fn(async () => {}),
  })),
}));

vi.mock('../../src/skills/GitHubRegistryFetcher.js', () => ({
  GitHubRegistryFetcher: vi.fn().mockImplementation(() => ({
    fetchRegistry: vi.fn(async () => ({
      version: '1.0.0',
      updatedAt: new Date().toISOString(),
      skills: [],
      categories: [],
    })),
    fetchSkillDirectory: vi.fn(async () => new Map()),
  })),
}));

vi.mock('../../src/skills/autoSkill.js', () => ({
  ProjectAnalyzer: vi.fn().mockImplementation(() => ({
    analyze: vi.fn(async () => ({
      projectName: 'test-app',
      languages: ['typescript'],
      frameworks: ['react'],
      patterns: ['testing'],
      dependencies: ['react', 'vitest'],
      filePatterns: [],
      platform: 'darwin',
      hasGit: true,
      hasTests: true,
      hasCI: false,
      packageManager: 'bun',
    })),
  })),
  buildSkillGenerationPrompt: vi.fn(() => 'mock prompt'),
}));

vi.mock('../../src/ui/ink/components/Modal.js', () => ({
  showModal: vi.fn(async () => null),
  showConfirm: vi.fn(async () => false),
}));

// ─── Test Helpers ───────────────────────────────────────────────────

function createMockLLM(response: string): LLMProvider {
  return {
    getName: () => 'mock',
    complete: vi.fn(async () => ({
      id: '1',
      created: Date.now(),
      content: response,
      finishReason: 'stop' as const,
    })),
    listModels: vi.fn(async () => []),
    isAvailable: vi.fn(async () => true),
    setModel: vi.fn(),
  };
}

function createMockRegistry() {
  return {
    listSkills: vi.fn(() => []),
    getActiveSkills: vi.fn(() => []),
    getSkill: vi.fn(),
    isSkillInstalled: vi.fn(async () => false),
    importCommunitySkillDirectory: vi.fn(async () => ({ success: true, path: '/test' })),
    saveSkill: vi.fn(async () => true),
    trackSkillEvent: vi.fn(),
  } as any;
}

// ─── Progress Tests ─────────────────────────────────────────────────

describe('/learn progress logging', () => {
  let consoleSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.clearAllMocks();
    consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(() => {
    consoleSpy.mockRestore();
  });

  it('logs sequential progress steps via console.log', async () => {
    const analysisResponse = JSON.stringify({
      projectSummary: 'TypeScript React app',
      audit: [],
      recommendations: [{ slug: 'react-testing', score: 85, reason: 'Great match' }],
      gapAnalysis: null,
    });
    const llm = createMockLLM(analysisResponse);

    await learn(
      {
        skillsRegistry: createMockRegistry(),
        workspaceRoot: '/test',
        llm,
        isNonInteractive: true,
      },
      [],
    );

    const loggedMessages = consoleSpy.mock.calls.map((call) => String(call[0]));
    const hasAnalyzing = loggedMessages.some((msg) => msg.includes('Analyzing'));
    expect(hasAnalyzing).toBe(true);
  });

  it('calls onProgress for each phase as a separate entry', async () => {
    const analysisResponse = JSON.stringify({
      projectSummary: 'TypeScript React app',
      audit: [],
      recommendations: [{ slug: 'react-testing', score: 85, reason: 'Great match' }],
      gapAnalysis: null,
    });
    const llm = createMockLLM(analysisResponse);
    const onProgress = vi.fn();

    await learn(
      {
        skillsRegistry: createMockRegistry(),
        workspaceRoot: '/test',
        llm,
        isNonInteractive: true,
        onProgress,
      },
      [],
    );

    // onProgress should be called at least 3 times with distinct messages
    expect(onProgress).toHaveBeenCalledTimes(3);

    const messages = onProgress.mock.calls.map((call: unknown[]) => call[0] as string);
    const uniqueMessages = new Set(messages);
    expect(uniqueMessages.size).toBeGreaterThanOrEqual(3);

    // Verify specific phases appear
    expect(messages.some((m: string) => m.includes('Analyzing'))).toBe(true);
    expect(messages.some((m: string) => m.includes('Loading'))).toBe(true);
    expect(messages.some((m: string) => m.includes('Evaluating'))).toBe(true);
  });
});

// ─── Modal Interaction Tests ────────────────────────────────────────

describe('/learn modal interaction', () => {
  beforeEach(() => {
    vi.spyOn(console, 'log').mockImplementation(() => {});
  });

  it('calls onBeforeModal/onAfterModal around showConfirm when no good matches', async () => {
    const beforeModal = vi.fn();
    const afterModal = vi.fn();

    // LLM returns low-scoring recommendations so showConfirm gets triggered
    const llm = createMockLLM(
      JSON.stringify({
        projectSummary: 'Test project',
        audit: [],
        recommendations: [{ slug: 'low-match', score: 30, reason: 'Poor fit' }],
        gapAnalysis: 'Needs custom skill',
      }),
    );

    await learn(
      {
        skillsRegistry: createMockRegistry() as any,
        workspaceRoot: '/tmp/test-project',
        llm,
        isNonInteractive: false,
        onBeforeModal: beforeModal,
        onAfterModal: afterModal,
      },
      [],
    );

    // showConfirm should have been called (mocked to return false)
    const { showConfirm } = await import('../../src/ui/ink/components/Modal.js');
    expect(showConfirm).toHaveBeenCalled();
    expect(beforeModal).toHaveBeenCalled();
    expect(afterModal).toHaveBeenCalled();
    // onAfterModal called after onBeforeModal (finally block)
    expect(afterModal.mock.invocationCallOrder[0]).toBeGreaterThan(
      beforeModal.mock.invocationCallOrder[0],
    );
  });
});
