/**
 * @license
 * Copyright 2025 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { act } from 'react';
import { Text } from 'ink';
import { render, cleanup } from 'ink-testing-library';
import { afterEach, describe, expect, it } from 'vitest';
import { ThemeProvider, useTheme } from '../../../src/ui/theme/ThemeContext.js';
import { initTheme } from '../../../src/ui/theme/loader.js';

function CurrentThemeName() {
  const { name } = useTheme();
  return <Text>{name}</Text>;
}

describe('ThemeProvider', () => {
  afterEach(() => {
    cleanup();
    initTheme('dark');
  });

  it('updates mounted Ink UI when the global theme changes', async () => {
    initTheme('dark');

    const { lastFrame } = render(
      <ThemeProvider>
        <CurrentThemeName />
      </ThemeProvider>
    );

    expect(lastFrame()).toContain('dark');

    await act(async () => {
      initTheme('light');
    });
    await new Promise((resolve) => setImmediate(resolve));

    expect(lastFrame()).toContain('light');
  });
});
