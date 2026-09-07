/**
 * @license
 * Copyright 2025 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { act } from 'react';
import { Text } from 'ink';
import { render, cleanup } from 'ink-testing-library';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ThemeProvider, useTheme } from '../../../src/ui/theme/ThemeContext.js';
import { initTheme } from '../../../src/ui/theme/loader.js';
import * as themeState from '../../../src/ui/theme/Theme.js';

function CurrentThemeName() {
  const { name } = useTheme();
  return <Text>{name}</Text>;
}

describe('ThemeProvider', () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    initTheme('dark');
  });

  it('uses Aurora before global theme initialization', () => {
    vi.spyOn(themeState, 'getThemeSnapshot').mockReturnValue(null);
    const { lastFrame } = render(<ThemeProvider><CurrentThemeName /></ThemeProvider>);
    expect(lastFrame()).toContain('aurora');
  });

  it.each(['light', 'tuatara', 'aurora'])('updates mounted Ink UI when the global theme changes to %s', async name => {
    initTheme('dark');

    const { lastFrame } = render(
      <ThemeProvider>
        <CurrentThemeName />
      </ThemeProvider>
    );

    expect(lastFrame()).toContain('dark');

    await act(async () => {
      initTheme(name);
    });
    await new Promise((resolve) => setImmediate(resolve));

    expect(lastFrame()).toContain(name);
  });
});
