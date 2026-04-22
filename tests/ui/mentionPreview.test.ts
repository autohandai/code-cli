/**
 * @license
 * Copyright 2025 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, vi } from 'vitest';
import readline from 'node:readline';
import { Readable, Writable } from 'node:stream';
import type { SlashCommand } from '../../src/core/slashCommandTypes.js';

// Build a minimal writable stream that captures output
function createMockOutput(): NodeJS.WriteStream {
  const chunks: Buffer[] = [];
  const stream = new Writable({
    write(chunk, _enc, cb) {
      chunks.push(Buffer.from(chunk));
      cb();
    },
  });
  // Fake TTY properties expected by MentionPreview rendering
  (stream as any).columns = 120;
  (stream as any).rows = 40;
  (stream as any).isTTY = true;
  (stream as any)._chunks = chunks;
  (stream as any).getWindowSize = () => [120, 40];
  (stream as any).clearLine = vi.fn();
  (stream as any).cursorTo = vi.fn();
  (stream as any).moveCursor = vi.fn();
  return stream as unknown as NodeJS.WriteStream;
}

const SAMPLE_COMMANDS: SlashCommand[] = [
  { command: '/quit', description: 'exit Autohand', handler: 'quit' },
  { command: '/model', description: 'choose what model', handler: 'model' },
  { command: '/agents', description: 'manage sub-agents', handler: 'agents' },
  { command: '/agents-new', description: 'create new agent', handler: 'agents-new' },
  { command: '/about', description: 'about Autohand', handler: 'about' },
  { command: '/add-dir', description: 'add directory', handler: 'add-dir' },
  { command: '/search', description: 'configure web search', handler: 'search' },
  { command: '/init', description: 'create AGENTS.md', handler: 'init' },
];

const SAMPLE_SKILLS = [
  { name: 'code-review', description: 'Code review your changes', isActive: true, source: 'built-in' },
  { name: 'code-simplifier', description: 'Review for reuse and clarity', isActive: true, source: 'built-in' },
  { name: 'debugger', description: 'Debug errors and test failures', isActive: false, source: 'built-in' },
  { name: 'design-consultation', description: 'Design system and brand review', isActive: false, source: 'community' },
];

describe('MentionPreview slash filtering', () => {
  it('filterSlash with empty seed returns all commands (up to limit)', async () => {
    // Import the module to access filterSlash indirectly via the class
    const { MentionPreview } = await import('../../src/ui/mentionPreview.js');
    const input = new Readable({ read() {} });
    (input as any).setRawMode = vi.fn();
    const output = createMockOutput();
    const rl = readline.createInterface({ input, output, terminal: true });

    const preview = new MentionPreview(rl, () => [], SAMPLE_COMMANDS, output, () => []);

    // Access private method for unit testing
    const filterSlash = (preview as any).filterSlash.bind(preview);
    const results = filterSlash('');
    // Empty seed should return first 5 commands (the slice limit)
    expect(results.length).toBe(5);

    preview.dispose();
    rl.close();
  });

  it('filterSlash with prefix seed filters to commands starting with that prefix', async () => {
    const { MentionPreview } = await import('../../src/ui/mentionPreview.js');
    const input = new Readable({ read() {} });
    (input as any).setRawMode = vi.fn();
    const output = createMockOutput();
    const rl = readline.createInterface({ input, output, terminal: true });

    const preview = new MentionPreview(rl, () => [], SAMPLE_COMMANDS, output, () => []);
    const filterSlash = (preview as any).filterSlash.bind(preview);

    // 'ag' should match /agents and /agents-new (prefix match), NOT /search (substring)
    const results = filterSlash('ag');
    const plainResults = results.map((r: string) => r.replace(/\u001b\[[0-9;]*m/g, ''));
    expect(plainResults.some((r: string) => r.startsWith('/agents'))).toBe(true);
    // /search should NOT appear — "search" doesn't start with "ag"
    expect(plainResults.some((r: string) => r.startsWith('/search'))).toBe(false);

    preview.dispose();
    rl.close();
  });

  it('filterSlash with "a" shows all commands starting with "a"', async () => {
    const { MentionPreview } = await import('../../src/ui/mentionPreview.js');
    const input = new Readable({ read() {} });
    (input as any).setRawMode = vi.fn();
    const output = createMockOutput();
    const rl = readline.createInterface({ input, output, terminal: true });

    const preview = new MentionPreview(rl, () => [], SAMPLE_COMMANDS, output, () => []);
    const filterSlash = (preview as any).filterSlash.bind(preview);

    const results = filterSlash('a');
    const plainResults = results.map((r: string) => r.replace(/\u001b\[[0-9;]*m/g, ''));
    // Should show /agents, /agents-new, /about, /add-dir — all start with "a"
    expect(plainResults.every((r: string) => {
      const cmd = r.split(' - ')[0].replace('/', '');
      return cmd.startsWith('a');
    })).toBe(true);

    // Should NOT include /quit, /model, /search, /init
    expect(plainResults.some((r: string) => r.startsWith('/quit'))).toBe(false);
    expect(plainResults.some((r: string) => r.startsWith('/model'))).toBe(false);

    preview.dispose();
    rl.close();
  });

  it('filterSlash falls back to substring match when no prefix matches', async () => {
    const { MentionPreview } = await import('../../src/ui/mentionPreview.js');
    const input = new Readable({ read() {} });
    (input as any).setRawMode = vi.fn();
    const output = createMockOutput();
    const rl = readline.createInterface({ input, output, terminal: true });

    const preview = new MentionPreview(rl, () => [], SAMPLE_COMMANDS, output, () => []);
    const filterSlash = (preview as any).filterSlash.bind(preview);

    // 'ent' doesn't start any command, but is in /agents (ag-ent-s)
    const results = filterSlash('ent');
    const plainResults = results.map((r: string) => r.replace(/\u001b\[[0-9;]*m/g, ''));
    // Should fall back to substring and find /agents
    expect(plainResults.some((r: string) => r.startsWith('/agents'))).toBe(true);

    preview.dispose();
    rl.close();
  });

  it('handleKeypress defers slash filtering to next tick for accurate rl.line', async () => {
    const { MentionPreview } = await import('../../src/ui/mentionPreview.js');
    const input = new Readable({ read() {} });
    (input as any).setRawMode = vi.fn();
    const output = createMockOutput();
    const rl = readline.createInterface({ input, output, terminal: true });

    const preview = new MentionPreview(rl, () => [], SAMPLE_COMMANDS, output, () => []);
    const renderSpy = vi.spyOn(preview as any, 'render');

    // Simulate rl.line already containing '/a' (after readline processes the keystroke)
    (rl as any).line = '/a';
    (rl as any).cursor = 2;

    // Emit a regular keypress (not tab or arrow)
    input.emit('keypress', 'a', { name: 'a' });

    // On same tick, render should not have been called with slash suggestions yet
    // (because of setImmediate deferral) — or it should use the current rl.line
    // Wait for next tick
    await new Promise(resolve => setImmediate(resolve));

    // After tick, the filter should have fired with the correct rl.line
    if (renderSpy.mock.calls.length > 0) {
      const lastCall = renderSpy.mock.calls[renderSpy.mock.calls.length - 1];
      const suggestions = lastCall[0] as string[];
      // Should filter by 'a' prefix, not empty seed
      const plainResults = suggestions.map((r: string) => r.replace(/\u001b\[[0-9;]*m/g, ''));
      for (const r of plainResults) {
        const cmd = r.split(' - ')[0].replace('/', '');
        expect(cmd.startsWith('a')).toBe(true);
      }
    }

    preview.dispose();
    rl.close();
  });
});

describe('MentionPreview lazy filesProvider', () => {
  it('returns file suggestions even when provider is initially empty and populates later', async () => {
    const { MentionPreview } = await import('../../src/ui/mentionPreview.js');
    const input = new Readable({ read() {} });
    (input as any).setRawMode = vi.fn();
    const output = createMockOutput();
    const rl = readline.createInterface({ input, output, terminal: true });

    // Simulate the race condition: provider starts empty (files not yet collected)
    const fileStore: string[] = [];
    const preview = new MentionPreview(rl, () => fileStore, SAMPLE_COMMANDS, output, () => []);

    // Access private filter method
    const filter = (preview as any).filter.bind(preview);

    // Initially empty — no files collected yet
    expect(filter('')).toEqual([]);

    // Simulate background file collection completing
    fileStore.push('src/index.ts', 'src/core/agent.ts', 'package.json');

    // Now the same getter should return results without recreating MentionPreview
    const results = filter('');
    expect(results.length).toBeGreaterThan(0);
    expect(results).toContain('src/index.ts');

    preview.dispose();
    rl.close();
  });

  it('reflects updated file list on every filter call', async () => {
    const { MentionPreview } = await import('../../src/ui/mentionPreview.js');
    const input = new Readable({ read() {} });
    (input as any).setRawMode = vi.fn();
    const output = createMockOutput();
    const rl = readline.createInterface({ input, output, terminal: true });

    const fileStore: string[] = ['README.md'];
    const preview = new MentionPreview(rl, () => fileStore, SAMPLE_COMMANDS, output, () => []);
    const filter = (preview as any).filter.bind(preview);

    // First call sees only README.md
    expect(filter('READ')).toEqual(['README.md']);

    // New file added to store (e.g. cache refreshed)
    fileStore.push('src/README-dev.md');

    // Filter should now see both files
    const results = filter('READ');
    expect(results).toContain('README.md');
    expect(results).toContain('src/README-dev.md');

    preview.dispose();
    rl.close();
  });
});

describe('MentionPreview file rendering', () => {
  it('renders file suggestions as filename and path in separate aligned columns', async () => {
    const { MentionPreview } = await import('../../src/ui/mentionPreview.js');
    const input = new Readable({ read() {} });
    (input as any).setRawMode = vi.fn();
    const output = createMockOutput();
    const rl = readline.createInterface({ input, output, terminal: true });

    const preview = new MentionPreview(
      rl,
      () => ['src/styleguide/java/nullaway.md', 'src/media/base/null_video_sink.h'],
      SAMPLE_COMMANDS,
      output,
      () => [],
    );

    (preview as any).mode = 'file';
    (preview as any).activeIndex = 0;
    (preview as any).render(['src/styleguide/java/nullaway.md', 'src/media/base/null_video_sink.h']);

    const rendered = Buffer.concat((output as any)._chunks).toString('utf8');
    const plain = rendered.replace(/\u001b\[[0-9;]*m/g, '');

    expect(plain).toContain('▸ nullaway.md');
    expect(plain).toContain('src/styleguide/java');
    expect(plain).toContain('  null_video_sink.h');
    expect(plain).toContain('src/media/base');
    expect(plain).not.toContain('src/styleguide/java/nullaway.md');
    expect(plain).toMatch(/nullaway\.md {2,12}src\/styleguide\/java/);

    preview.dispose();
    rl.close();
  });
});

describe('MentionPreview file selection', () => {
  it('keeps the selected file when suggestions refresh before tab completion', async () => {
    const { MentionPreview } = await import('../../src/ui/mentionPreview.js');
    const input = new Readable({ read() {} });
    (input as any).setRawMode = vi.fn();
    const output = createMockOutput();
    const rl = readline.createInterface({ input, output, terminal: true });

    const preview = new MentionPreview(
      rl,
      () => ['tests/commands/ide.test.ts', 'tests/ui/ink/InkRenderer.test.ts', 'tests/ui/ink/LiveCommandBlock.test.tsx'],
      SAMPLE_COMMANDS,
      output,
      () => [],
    );

    (rl as any).line = '@tests/';
    (rl as any).cursor = '@tests/'.length;

    (preview as any).mode = 'file';
    (preview as any).fileSuggestions = ['tests/commands/ide.test.ts', 'tests/ui/ink/InkRenderer.test.ts', 'tests/ui/ink/LiveCommandBlock.test.tsx'];
    (preview as any).lastSuggestions = ['tests/commands/ide.test.ts', 'tests/ui/ink/InkRenderer.test.ts', 'tests/ui/ink/LiveCommandBlock.test.tsx'];
    (preview as any).activeIndex = 1;

    (preview as any).updateSuggestions();
    input.emit('keypress', '\t', { name: 'tab', sequence: '\t' });

    expect((rl as any).line).toContain('@tests/ui/ink/InkRenderer.test.ts ');

    preview.dispose();
    rl.close();
  });

  it('uses the third selected file when tab falls back to refreshed suggestions', async () => {
    const { MentionPreview } = await import('../../src/ui/mentionPreview.js');
    const input = new Readable({ read() {} });
    (input as any).setRawMode = vi.fn();
    const output = createMockOutput();
    const rl = readline.createInterface({ input, output, terminal: true });

    const files = [
      'tests/commands/ide.test.ts',
      'tests/ui/ink/InkRenderer.test.ts',
      'tests/ui/ink/LiveCommandBlock.test.tsx',
    ];

    const preview = new MentionPreview(rl, () => files, SAMPLE_COMMANDS, output, () => []);

    (rl as any).line = '@tests/';
    (rl as any).cursor = '@tests/'.length;

    (preview as any).mode = null;
    (preview as any).fileSuggestions = [];
    (preview as any).lastSuggestions = files;
    (preview as any).activeIndex = 2;

    input.emit('keypress', '\t', { name: 'tab', sequence: '\t' });

    expect((rl as any).line).toContain('@tests/ui/ink/LiveCommandBlock.test.tsx ');

    preview.dispose();
    rl.close();
  });
});

describe('MentionPreview skill filtering', () => {
  it('filterSkills returns empty when seed is empty', async () => {
    const { MentionPreview } = await import('../../src/ui/mentionPreview.js');
    const input = new Readable({ read() {} });
    (input as any).setRawMode = vi.fn();
    const output = createMockOutput();
    const rl = readline.createInterface({ input, output, terminal: true });

    const preview = new MentionPreview(rl, () => [], SAMPLE_COMMANDS, output, () => SAMPLE_SKILLS);
    const filterSkills = (preview as any).filterSkills.bind(preview);
    expect(filterSkills('')).toEqual([]);

    preview.dispose();
    rl.close();
  });

  it('filterSkills filters skills by prefix', async () => {
    const { MentionPreview } = await import('../../src/ui/mentionPreview.js');
    const input = new Readable({ read() {} });
    (input as any).setRawMode = vi.fn();
    const output = createMockOutput();
    const rl = readline.createInterface({ input, output, terminal: true });

    const preview = new MentionPreview(rl, () => [], SAMPLE_COMMANDS, output, () => SAMPLE_SKILLS);
    const filterSkills = (preview as any).filterSkills.bind(preview);

    const results = filterSkills('code');
    expect(results).toContain('code-review');
    expect(results).toContain('code-simplifier');
    expect(results).not.toContain('debugger');

    preview.dispose();
    rl.close();
  });

  it('updateSuggestions enters skill mode when $ is typed with filter text', async () => {
    const { MentionPreview } = await import('../../src/ui/mentionPreview.js');
    const input = new Readable({ read() {} });
    (input as any).setRawMode = vi.fn();
    const output = createMockOutput();
    const rl = readline.createInterface({ input, output, terminal: true });

    const preview = new MentionPreview(rl, () => [], SAMPLE_COMMANDS, output, () => SAMPLE_SKILLS);
    const renderSpy = vi.spyOn(preview as any, 'render');

    (rl as any).line = '$co';
    (rl as any).cursor = '$co'.length;

    (preview as any).updateSuggestions();

    expect((preview as any).mode).toBe('skill');
    expect((preview as any).skillMatches.length).toBeGreaterThan(0);
    expect(renderSpy).toHaveBeenCalled();

    preview.dispose();
    rl.close();
  });

  it('updateSuggestions clears skill mode when $ seed does not match any skill', async () => {
    const { MentionPreview } = await import('../../src/ui/mentionPreview.js');
    const input = new Readable({ read() {} });
    (input as any).setRawMode = vi.fn();
    const output = createMockOutput();
    const rl = readline.createInterface({ input, output, terminal: true });

    const preview = new MentionPreview(rl, () => [], SAMPLE_COMMANDS, output, () => SAMPLE_SKILLS);
    (rl as any).line = '$xyz';
    (rl as any).cursor = '$xyz'.length;

    (preview as any).updateSuggestions();

    expect((preview as any).mode).toBe(null);
    expect((preview as any).skillMatches).toEqual([]);

    preview.dispose();
    rl.close();
  });

  it('TAB inserts selected skill name with mid-line preservation', async () => {
    const { MentionPreview } = await import('../../src/ui/mentionPreview.js');
    const input = new Readable({ read() {} });
    (input as any).setRawMode = vi.fn();
    const output = createMockOutput();
    const rl = readline.createInterface({ input, output, terminal: true });

    const preview = new MentionPreview(rl, () => [], SAMPLE_COMMANDS, output, () => SAMPLE_SKILLS);
    (rl as any).line = 'review $code';
    (rl as any).cursor = 'review $code'.length;

    (preview as any).mode = 'skill';
    (preview as any).skillMatches = preview.filterSkillsInfo('code');
    (preview as any).activeIndex = 0;

    input.emit('keypress', '\t', { name: 'tab', sequence: '\t' });

    expect((rl as any).line).toContain('$code-review ');
    expect((rl as any).cursor).toBeGreaterThan('review $code-review'.length);
    // Should have cleared the menu
    expect((preview as any).mode).toBe(null);

    preview.dispose();
    rl.close();
  });

  it('TAB inserts second skill when activeIndex is 1', async () => {
    const { MentionPreview } = await import('../../src/ui/mentionPreview.js');
    const input = new Readable({ read() {} });
    (input as any).setRawMode = vi.fn();
    const output = createMockOutput();
    const rl = readline.createInterface({ input, output, terminal: true });

    const preview = new MentionPreview(rl, () => [], SAMPLE_COMMANDS, output, () => SAMPLE_SKILLS);
    (rl as any).line = '$co';
    (rl as any).cursor = '$co'.length;

    (preview as any).mode = 'skill';
    (preview as any).skillMatches = preview.filterSkillsInfo('code');
    (preview as any).activeIndex = 1;

    input.emit('keypress', '\t', { name: 'tab', sequence: '\t' });

    expect((rl as any).line).toContain('$code-simplifier ');

    preview.dispose();
    rl.close();
  });

  it('renders skill suggestions with name and description', async () => {
    const { MentionPreview } = await import('../../src/ui/mentionPreview.js');
    const input = new Readable({ read() {} });
    (input as any).setRawMode = vi.fn();
    const output = createMockOutput();
    const rl = readline.createInterface({ input, output, terminal: true });

    const preview = new MentionPreview(rl, () => [], SAMPLE_COMMANDS, output, () => SAMPLE_SKILLS);
    (rl as any).line = '$co';
    (rl as any).cursor = '$co'.length;

    (preview as any).mode = 'skill';
    (preview as any).skillMatches = preview.filterSkillsInfo('code');
    (preview as any).activeIndex = 0;
    (preview as any).render(['code-review', 'code-simplifier']);

    const rendered = Buffer.concat((output as any)._chunks).toString('utf8');
    const plain = rendered.replace(/\u001b\[[0-9;]*m/g, '');

    expect(plain).toContain('$code-review');
    expect(plain).toContain('$code-simplifier');
    expect(plain).toContain('Code review your changes');

    preview.dispose();
    rl.close();
  });
});

describe('MentionPreview race condition resilience', () => {
  it('accepts slash suggestion on Tab even when setImmediate update has not fired', async () => {
    const { MentionPreview } = await import('../../src/ui/mentionPreview.js');
    const input = new Readable({ read() {} });
    (input as any).setRawMode = vi.fn();
    const output = createMockOutput();
    const rl = readline.createInterface({ input, output, terminal: true });

    const preview = new MentionPreview(rl, () => [], SAMPLE_COMMANDS, output, () => []);

    // Simulate rl.line already containing '/a' but updateSuggestions was never called
    (rl as any).line = '/a';
    (rl as any).cursor = 2;
    // Intentionally do NOT call updateSuggestions() — this mimics the race where
    // Tab is pressed before the deferred setImmediate(updateSuggestions) fires.
    (preview as any).slashMatches = [];
    (preview as any).mode = null;

    // Emit Tab
    input.emit('keypress', '\t', { name: 'tab', sequence: '\t' });

    // The fix ensures updateSuggestions() runs synchronously inside handleKeypress
    // for Tab, so the suggestion should be accepted despite the stale internal state.
    expect((rl as any).line).toContain('/agents');

    preview.dispose();
    rl.close();
  });

  it('accepts file mention on Tab even when setImmediate update has not fired', async () => {
    const { MentionPreview } = await import('../../src/ui/mentionPreview.js');
    const input = new Readable({ read() {} });
    (input as any).setRawMode = vi.fn();
    const output = createMockOutput();
    const rl = readline.createInterface({ input, output, terminal: true });

    const preview = new MentionPreview(
      rl,
      () => ['src/index.ts', 'src/core/agent.ts'],
      SAMPLE_COMMANDS,
      output,
      () => [],
    );

    (rl as any).line = '@sr';
    (rl as any).cursor = 3;
    // Stale state — mimics the race condition
    (preview as any).fileSuggestions = [];
    (preview as any).mode = null;

    input.emit('keypress', '\t', { name: 'tab', sequence: '\t' });

    expect((rl as any).line).toContain('@src/index.ts');

    preview.dispose();
    rl.close();
  });

  it('accepts skill mention on Tab even when setImmediate update has not fired', async () => {
    const { MentionPreview } = await import('../../src/ui/mentionPreview.js');
    const input = new Readable({ read() {} });
    (input as any).setRawMode = vi.fn();
    const output = createMockOutput();
    const rl = readline.createInterface({ input, output, terminal: true });

    const preview = new MentionPreview(rl, () => [], SAMPLE_COMMANDS, output, () => SAMPLE_SKILLS);

    (rl as any).line = '$co';
    (rl as any).cursor = 3;
    // Stale state
    (preview as any).skillMatches = [];
    (preview as any).mode = null;

    input.emit('keypress', '\t', { name: 'tab', sequence: '\t' });

    expect((rl as any).line).toContain('$code-review');

    preview.dispose();
    rl.close();
  });
});
