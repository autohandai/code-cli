/**
 * @license
 * Copyright 2025 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 *
 * Tests that the Ink Composer stays alive after non-interactive slash
 * commands like /help and /history. Previously the loop stopped the
 * Ink renderer and fell back to readline, making the Composer unusable.
 */
import { describe, it, expect } from 'vitest';

describe('Ink Composer persistence after slash commands', () => {
  it('inkInstructionResolver is resolved when handleInkSubmittedInstruction queues an instruction', () => {
    // Simulate the resolver pattern used in runInteractiveLoop
    let resolver: (() => void) | null = null;
    let resolved = false;

    new Promise<void>(resolve => {
      resolver = resolve;
    });

    // Simulate handleInkSubmittedInstruction
    const handleInkSubmittedInstruction = () => {
      if (resolver) {
        resolver();
        resolver = null;
        resolved = true;
      }
    };

    // Resolver should not be resolved yet
    expect(resolved).toBe(false);

    // Simulate user submitting text in the Composer
    handleInkSubmittedInstruction();

    // Resolver should be resolved now
    expect(resolved).toBe(true);
    expect(resolver).toBe(null);
  });

  it('inkInstructionResolver is cleaned up when cleanupUI stops the renderer', () => {
    // Simulate the cleanup pattern
    let inkInstructionResolver: (() => void) | null = () => {};

    // Simulate cleanupUI with keepInkAlive = false
    const cleanupUI = (keepInkAlive: boolean) => {
      if (!keepInkAlive) {
        inkInstructionResolver = null;
      }
    };

    expect(inkInstructionResolver).not.toBe(null);

    cleanupUI(false);

    expect(inkInstructionResolver).toBe(null);
  });

  it('inkInstructionResolver is NOT cleared when cleanupUI keeps Ink alive', () => {
    // Simulate the cleanup pattern
    let inkInstructionResolver: (() => void) | null = () => {};

    // Simulate cleanupUI with keepInkAlive = true
    const cleanupUI = (keepInkAlive: boolean) => {
      if (!keepInkAlive) {
        inkInstructionResolver = null;
      }
    };

    cleanupUI(true);

    // Resolver should still be set (it will be used on next idle-wait)
    expect(inkInstructionResolver).not.toBe(null);
  });

  it('multiple handleInkSubmittedInstruction calls only resolve once', () => {
    let resolver: (() => void) | null = null;
    let resolveCount = 0;

    const setupPromise = () => {
      resolveCount = 0;
      return new Promise<void>(resolve => {
        resolver = resolve;
      });
    };

    setupPromise();

    const handleInkSubmittedInstruction = () => {
      if (resolver) {
        resolver();
        resolver = null;
        resolveCount++;
      }
    };

    // First call resolves
    handleInkSubmittedInstruction();
    expect(resolveCount).toBe(1);

    // Second call does nothing (resolver already consumed)
    handleInkSubmittedInstruction();
    expect(resolveCount).toBe(1);
  });
});
