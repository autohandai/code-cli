/**
 * @license
 * Copyright 2025 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect } from 'vitest';

/**
 * Tests for yoga-layout initialization.
 *
 * Ink 7 imports yoga-layout directly. The package must export a ready-to-use
 * module with Node.create, Config, and the layout constants Ink expects.
 */
describe('yoga-layout initialization', () => {
  it('should export a module object, not a function', async () => {
    const Yoga = (await import('yoga-layout')).default;

    expect(typeof Yoga).not.toBe('function');
    expect(typeof Yoga).toBe('object');
  });

  it('should have a Node property', async () => {
    const Yoga = (await import('yoga-layout')).default;

    expect(Yoga).toHaveProperty('Node');
    expect(Yoga.Node).toBeDefined();
  });

  it('should have Node.create as a callable function', async () => {
    const Yoga = (await import('yoga-layout')).default;

    expect(typeof Yoga.Node.create).toBe('function');
  });

  it('should create a yoga node without throwing', async () => {
    const Yoga = (await import('yoga-layout')).default;

    let node: any;
    expect(() => {
      node = Yoga.Node.create();
    }).not.toThrow();

    expect(node).toBeDefined();

    // Cleanup
    node.free();
  });

  it('should have a Config property', async () => {
    const Yoga = (await import('yoga-layout')).default;

    expect(Yoga).toHaveProperty('Config');
    expect(Yoga.Config).toBeDefined();
  });

  it('should export yoga layout constants', async () => {
    const Yoga = (await import('yoga-layout')).default;

    // Spot-check constants that Ink uses for layout
    expect(Yoga).toHaveProperty('DIRECTION_LTR');
    expect(Yoga).toHaveProperty('FLEX_DIRECTION_ROW');
    expect(Yoga).toHaveProperty('FLEX_DIRECTION_COLUMN');
    expect(Yoga).toHaveProperty('ALIGN_CENTER');
  });

  it('should create a node, set layout properties, and calculate layout', async () => {
    const Yoga = (await import('yoga-layout')).default;

    const root = Yoga.Node.create();
    root.setWidth(100);
    root.setHeight(50);
    root.setFlexDirection(Yoga.FLEX_DIRECTION_ROW);

    const child = Yoga.Node.create();
    child.setWidth(40);
    child.setHeight(20);
    root.insertChild(child, 0);

    root.calculateLayout(100, 50, Yoga.DIRECTION_LTR);

    expect(root.getComputedWidth()).toBe(100);
    expect(root.getComputedHeight()).toBe(50);
    expect(child.getComputedWidth()).toBe(40);
    expect(child.getComputedHeight()).toBe(20);

    // Cleanup
    child.free();
    root.free();
  });
});

describe('Ink render integration', () => {
  it('should render a basic React element without asm.Node.create error', async () => {
    const React = await import('react');
    const { render, Box, Text } = await import('ink');

    // This is the exact code path that triggers the bug:
    // render() → reconciler → createNode('ink-box') → Yoga.Node.create()
    // If yoga-layout does not export a ready Yoga module, Ink cannot create
    // layout nodes during render.
    let error: Error | null = null;
    try {
      const instance = render(
        React.createElement(Box, null,
          React.createElement(Text, null, 'test')
        ),
        { exitOnCtrlC: false, patchConsole: false }
      );
      // Unmount immediately - we only care that render didn't throw
      instance.unmount();
    } catch (e) {
      error = e as Error;
    }

    expect(error).toBeNull();
  });
});
