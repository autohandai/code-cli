import { afterEach, describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { review } from '../src/commands/review.js';
import type { SlashCommandContext } from '../src/core/slashCommandTypes.js';

describe('review command RPC/ACP mode', () => {
  afterEach(() => vi.restoreAllMocks());

  it('review command checks isNonInteractive to decide behavior', () => {
    const source = readFileSync('src/commands/review.ts', 'utf-8');
    expect(source).toContain('isNonInteractive');
  });

  it('returns prompt text when isNonInteractive is true (even if queueInstruction exists)', async () => {
    const queueInstruction = vi.fn();
    const result = await review({
      workspaceRoot: process.cwd(),
      isNonInteractive: true,
      queueInstruction,
    } as SlashCommandContext);

    expect(result).toContain('# Autohand Review invocation');
    expect(queueInstruction).not.toHaveBeenCalled();
  });

  it('keeps status messages out of noninteractive stdout', async () => {
    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const context = {
      workspaceRoot: process.cwd(),
      isNonInteractive: true,
      queueInstruction: vi.fn(),
    } as SlashCommandContext;

    await review(context);
    expect(consoleSpy).not.toHaveBeenCalled();

    await review({ ...context, isNonInteractive: false });
    expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('Starting Autohand Review'));
  });
});

describe('executeCodeReview fires hooks', () => {
  it('executeCodeReview source contains review:start hook call', () => {
    const source = readFileSync('src/core/actionExecutor.ts', 'utf-8');
    expect(source).toContain("'review:start'");
  });

  it('executeCodeReview source contains review:completed hook call', () => {
    const source = readFileSync('src/core/actionExecutor.ts', 'utf-8');
    expect(source).toContain("'review:completed'");
  });

  it('executeCodeReview source contains review:failed hook call', () => {
    const source = readFileSync('src/core/actionExecutor.ts', 'utf-8');
    expect(source).toContain("'review:failed'");
  });

  it('ActionExecutor accepts an onReviewHook callback', () => {
    const source = readFileSync('src/core/actionExecutor.ts', 'utf-8');
    expect(source).toContain('onReviewHook');
  });
});

describe('review hook events', () => {
  it('HookEvent type includes all review lifecycle events', async () => {
    const { HOOK_EVENTS } = await import('../src/commands/hooks.js');
    expect(HOOK_EVENTS).toContain('review:start');
    expect(HOOK_EVENTS).toContain('review:end');
    expect(HOOK_EVENTS).toContain('review:paused');
    expect(HOOK_EVENTS).toContain('review:failed');
    expect(HOOK_EVENTS).toContain('review:completed');
  });
});

describe('code_review tool registration', () => {
  it('code_review tool is registered in DEFAULT_TOOL_DEFINITIONS', async () => {
    const { DEFAULT_TOOL_DEFINITIONS } = await import('../src/core/toolManager.js');
    const reviewTool = DEFAULT_TOOL_DEFINITIONS.find((t: any) => t.name === 'code_review');

    expect(reviewTool).toBeDefined();
    expect(reviewTool!.description).toContain('review');
    expect(reviewTool!.parameters?.properties).toHaveProperty('path');
    expect(reviewTool!.parameters?.properties).toHaveProperty('scope');
    expect(reviewTool!.parameters?.properties).toHaveProperty('instructions');
  });

  it('scope parameter has correct enum values', async () => {
    const { DEFAULT_TOOL_DEFINITIONS } = await import('../src/core/toolManager.js');
    const reviewTool = DEFAULT_TOOL_DEFINITIONS.find((t: any) => t.name === 'code_review');
    const scopeParam = reviewTool?.parameters?.properties?.scope as any;

    expect(scopeParam?.enum).toEqual(['full', 'diff', 'file']);
  });
});

describe('code_review action execution', () => {
  it('code_review is a recognized action type in ActionExecutor', () => {
    const source = readFileSync('src/core/actionExecutor.ts', 'utf-8');
    expect(source).toContain("case 'code_review'");
  });

  it('ActionExecutor has an executeCodeReview method', () => {
    const source = readFileSync('src/core/actionExecutor.ts', 'utf-8');
    expect(source).toContain('executeCodeReview');
  });

  it('executeCodeReview handles diff scope', () => {
    const source = readFileSync('src/core/actionExecutor.ts', 'utf-8');
    // Must handle 'diff' scope by running git diff
    expect(source).toMatch(/scope\s*===?\s*['"]diff['"]/);
  });

  it('executeCodeReview handles file scope', () => {
    const source = readFileSync('src/core/actionExecutor.ts', 'utf-8');
    // Must handle 'file' scope by reading a specific file
    expect(source).toMatch(/scope\s*===?\s*['"]file['"]/);
  });

  it('executeCodeReview returns a result string with review info', () => {
    const source = readFileSync('src/core/actionExecutor.ts', 'utf-8');
    expect(source).toContain('Code review initiated');
    expect(source).toContain('Scope:');
  });
});

describe('review hook env vars in HookManager', () => {
  it('buildEnvironment sets HOOK_REVIEW_PATH for review events', () => {
    const source = readFileSync('src/core/HookManager.ts', 'utf-8');
    expect(source).toContain('HOOK_REVIEW_PATH');
  });

  it('buildEnvironment sets HOOK_REVIEW_SCOPE for review events', () => {
    const source = readFileSync('src/core/HookManager.ts', 'utf-8');
    expect(source).toContain('HOOK_REVIEW_SCOPE');
  });

  it('buildEnvironment sets HOOK_REVIEW_ERROR for review events', () => {
    const source = readFileSync('src/core/HookManager.ts', 'utf-8');
    expect(source).toContain('HOOK_REVIEW_ERROR');
  });

  it('buildEnvironment sets HOOK_REVIEW_INSTRUCTIONS for review events', () => {
    const source = readFileSync('src/core/HookManager.ts', 'utf-8');
    expect(source).toContain('HOOK_REVIEW_INSTRUCTIONS');
  });

  it('HookContext includes review-specific fields', () => {
    const source = readFileSync('src/core/HookManager.ts', 'utf-8');
    expect(source).toContain('reviewPath');
    expect(source).toContain('reviewScope');
    expect(source).toContain('reviewInstructions');
    expect(source).toContain('reviewError');
  });
});

describe('review event icons in hooks command', () => {
  it('eventHeaderIcons includes review:start icon', () => {
    const source = readFileSync('src/commands/hooks.ts', 'utf-8');
    expect(source).toContain("'review:start'");
    // Should be in the eventHeaderIcons mapping
    expect(source).toMatch(/['"]review:start['"]\s*:/);
  });

  it('eventHeaderIcons includes review:completed icon', () => {
    const source = readFileSync('src/commands/hooks.ts', 'utf-8');
    expect(source).toMatch(/['"]review:completed['"]\s*:/);
  });

  it('eventHeaderIcons includes review:failed icon', () => {
    const source = readFileSync('src/commands/hooks.ts', 'utf-8');
    expect(source).toMatch(/['"]review:failed['"]\s*:/);
  });

  it('eventHeaderIcons includes review:end icon', () => {
    const source = readFileSync('src/commands/hooks.ts', 'utf-8');
    expect(source).toMatch(/['"]review:end['"]\s*:/);
  });

  it('eventHeaderIcons includes review:paused icon', () => {
    const source = readFileSync('src/commands/hooks.ts', 'utf-8');
    expect(source).toMatch(/['"]review:paused['"]\s*:/);
  });
});
