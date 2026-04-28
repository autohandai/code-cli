/**
 * @license
 * Copyright 2025 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { InkRenderer } from '../../src/ui/ink/InkRenderer.js';

describe('InkRenderer clearQueue', () => {
  let renderer: InkRenderer;

  beforeEach(() => {
    renderer = new InkRenderer({
      onInstruction: vi.fn(),
      onEscape: vi.fn(),
      onCtrlC: vi.fn(),
    });
  });

  afterEach(() => {
    renderer.stop();
    vi.restoreAllMocks();
  });

  it('should clear all queued instructions', () => {
    // Add some instructions to the queue
    renderer.addQueuedInstruction('instruction 1');
    renderer.addQueuedInstruction('instruction 2');
    renderer.addQueuedInstruction('instruction 3');
    
    // Verify queue has items
    expect(renderer.getQueueCount()).toBe(3);
    expect(renderer.hasQueuedInstructions()).toBe(true);
    
    // Clear the queue
    renderer.clearQueue();
    
    // Verify queue is empty
    expect(renderer.getQueueCount()).toBe(0);
    expect(renderer.hasQueuedInstructions()).toBe(false);
  });

  it('should be safe to call clearQueue on empty queue', () => {
    expect(renderer.getQueueCount()).toBe(0);
    
    // Should not throw
    expect(() => renderer.clearQueue()).not.toThrow();
    
    expect(renderer.getQueueCount()).toBe(0);
  });

  it('should clear queue after dequeuing some items', () => {
    renderer.addQueuedInstruction('instruction 1');
    renderer.addQueuedInstruction('instruction 2');
    renderer.addQueuedInstruction('instruction 3');
    
    // Dequeue one item
    const dequeued = renderer.dequeueInstruction();
    expect(dequeued).toBe('instruction 1');
    expect(renderer.getQueueCount()).toBe(2);
    
    // Clear remaining
    renderer.clearQueue();
    expect(renderer.getQueueCount()).toBe(0);
    expect(renderer.dequeueInstruction()).toBeUndefined();
  });
});
