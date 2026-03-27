import { describe, it, expect } from 'vitest';

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
