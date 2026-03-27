import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

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
