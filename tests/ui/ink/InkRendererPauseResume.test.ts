/**
 * @license
 * Copyright 2025 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 *
 * Tests for InkRenderer pause/resume cycle
 * Verifies that resume() is async and yields to let React 19 cleanup flush
 */

import { describe, expect, it } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';

describe('InkRenderer pause/resume React 19 fix', () => {
  it('resume() is declared as async function', async () => {
    // Read the source file
    const src = fs.readFileSync(
      path.resolve(process.cwd(), 'src/ui/ink/InkRenderer.tsx'),
      'utf8',
    );

    // Verify resume() is declared as async
    expect(src).toMatch(/async resume\(\): Promise<void>/);
  });

  it('resume() yields with setImmediate before creating new Ink instance', async () => {
    const src = fs.readFileSync(
      path.resolve(process.cwd(), 'src/ui/ink/InkRenderer.tsx'),
      'utf8',
    );

    // Verify the setImmediate yield is present in resume()
    // This is the key fix for React 19 deferred cleanup issue
    expect(src).toContain('await new Promise<void>((resolve) => setImmediate(resolve))');
  });

  it('resume() contains explanatory comment about React 19 cleanup', async () => {
    const src = fs.readFileSync(
      path.resolve(process.cwd(), 'src/ui/ink/InkRenderer.tsx'),
      'utf8',
    );

    // Verify the comment explains why the yield is needed
    expect(src).toContain('React 19\'s Scheduler flushes any pending passive');
    expect(src).toContain('effect cleanup from a just-unmounted Ink instance');
  });
});

describe('Agent.ts awaits inkRenderer.resume() calls', () => {
  const readAgentRuntimeSources = () => [
    fs.readFileSync(path.resolve(process.cwd(), 'src/core/agent.ts'), 'utf8'),
    fs.readFileSync(path.resolve(process.cwd(), 'src/core/agent/AgentDependencyComposer.ts'), 'utf8'),
    fs.readFileSync(path.resolve(process.cwd(), 'src/core/agent/InstructionRunner.ts'), 'utf8'),
  ].join('\n');

  it('all inkRenderer.resume() calls are awaited in agent runtime sources', async () => {
    const src = readAgentRuntimeSources();

    // Count non-awaited resume() calls (should be 0)
    // Match patterns that are NOT awaited
    const nonAwaitedPattern = /(?<!await\s)(?:this|host)\.inkRenderer\.resume\(\)/g;
    const matches = src.match(nonAwaitedPattern);

    // All resume() calls should be awaited
    expect(matches).toBeNull();
  });

  it('onAfterModal is async to support await resume()', async () => {
    const src = fs.readFileSync(
      path.resolve(process.cwd(), 'src/core/agent/AgentDependencyComposer.ts'),
      'utf8',
    );

    // Verify onAfterModal is declared as async
    expect(src).toMatch(/onAfterModal:\s*async\s*\(\)/);
  });

  it('onAfterModal awaits inkRenderer.resume()', async () => {
    const src = fs.readFileSync(
      path.resolve(process.cwd(), 'src/core/agent/AgentDependencyComposer.ts'),
      'utf8',
    );

    // Verify onAfterModal awaits the resume call
    expect(src).toMatch(/onAfterModal:[\s\S]*?await\s+host\.inkRenderer\.resume\(\)/);
  });
});

describe('SlashCommandTypes onAfterModal type allows async', () => {
  it('onAfterModal type includes Promise<void> return', async () => {
    const src = fs.readFileSync(
      path.resolve(process.cwd(), 'src/core/slashCommandTypes.ts'),
      'utf8',
    );

    // Verify the type allows async functions
    expect(src).toContain('onAfterModal?: () => void | Promise<void>');
  });
});
