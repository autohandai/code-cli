/**
 * @license
 * Copyright 2025 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  parseGhosttyTheme,
  ghosttyPaletteToTheme,
  findGhosttyThemesDir,
  listGhosttyThemes,
  loadGhosttyTheme,
  isInsideGhostty,
  readGhosttyConfigTheme,
  detectGhosttyTheme,
} from '../../../src/ui/theme/ghosttyLoader.js';
import { COLOR_TOKENS } from '../../../src/ui/theme/types.js';

const CATPPUCCIN_MOCHA = `palette = 0=#45475a
palette = 1=#f38ba8
palette = 2=#a6e3a1
palette = 3=#f9e2af
palette = 4=#89b4fa
palette = 5=#f5c2e7
palette = 6=#94e2d5
palette = 7=#a6adc8
palette = 8=#585b70
palette = 9=#f37799
palette = 10=#89d88b
palette = 11=#ebd391
palette = 12=#74a8fc
palette = 13=#f2aede
palette = 14=#6bd7ca
palette = 15=#bac2de
background = #1e1e2e
foreground = #cdd6f4
cursor-color = #f5e0dc
cursor-text = #1e1e2e
selection-background = #585b70
selection-foreground = #cdd6f4`;

describe('parseGhosttyTheme', () => {
  it('parses all 16 palette entries', () => {
    const result = parseGhosttyTheme(CATPPUCCIN_MOCHA);
    expect(result.palette.size).toBe(16);
    expect(result.palette.get(0)).toBe('#45475a');
    expect(result.palette.get(4)).toBe('#89b4fa');
    expect(result.palette.get(15)).toBe('#bac2de');
  });

  it('parses background and foreground', () => {
    const result = parseGhosttyTheme(CATPPUCCIN_MOCHA);
    expect(result.background).toBe('#1e1e2e');
    expect(result.foreground).toBe('#cdd6f4');
  });

  it('parses cursor and selection colors', () => {
    const result = parseGhosttyTheme(CATPPUCCIN_MOCHA);
    expect(result.cursorColor).toBe('#f5e0dc');
    expect(result.cursorText).toBe('#1e1e2e');
    expect(result.selectionBackground).toBe('#585b70');
    expect(result.selectionForeground).toBe('#cdd6f4');
  });

  it('handles empty and comment lines', () => {
    const content = `# This is a comment

palette = 0=#000000
background = #111111
foreground = #eeeeee`;
    const result = parseGhosttyTheme(content);
    expect(result.palette.get(0)).toBe('#000000');
    expect(result.background).toBe('#111111');
  });

  it('ignores invalid palette entries', () => {
    const content = `palette = abc=#000000
palette = 0=invalid
palette = 1=#ff0000
background = #000000
foreground = #ffffff`;
    const result = parseGhosttyTheme(content);
    expect(result.palette.size).toBe(1);
    expect(result.palette.get(1)).toBe('#ff0000');
  });

  it('uses fallback bg/fg when not specified', () => {
    const result = parseGhosttyTheme('');
    expect(result.background).toBe('#1a1a1a');
    expect(result.foreground).toBe('#e0e0e0');
  });
});

describe('ghosttyPaletteToTheme', () => {
  it('produces a ThemeDefinition with all required color tokens', () => {
    const palette = parseGhosttyTheme(CATPPUCCIN_MOCHA);
    const theme = ghosttyPaletteToTheme('Catppuccin Mocha', palette);

    expect(theme.name).toBe('Catppuccin Mocha');
    for (const token of COLOR_TOKENS) {
      expect(theme.colors[token]).toBeDefined();
    }
  });

  it('has vars for all 16 ANSI colors plus derived colors', () => {
    const palette = parseGhosttyTheme(CATPPUCCIN_MOCHA);
    const theme = ghosttyPaletteToTheme('test', palette);

    expect(theme.vars).toBeDefined();
    expect(theme.vars!.black).toBe('#45475a');
    expect(theme.vars!.red).toBe('#f38ba8');
    expect(theme.vars!.green).toBe('#a6e3a1');
    expect(theme.vars!.blue).toBe('#89b4fa');
    expect(theme.vars!.brightWhite).toBe('#bac2de');
    expect(theme.vars!.bg).toBe('#1e1e2e');
    expect(theme.vars!.fg).toBe('#cdd6f4');
  });

  it('maps success/error/warning to correct palette colors', () => {
    const palette = parseGhosttyTheme(CATPPUCCIN_MOCHA);
    const theme = ghosttyPaletteToTheme('test', palette);

    expect(theme.colors.success).toBe('green');
    expect(theme.colors.error).toBe('red');
    expect(theme.colors.warning).toBe('yellow');
  });

  it('uses blue as accent', () => {
    const palette = parseGhosttyTheme(CATPPUCCIN_MOCHA);
    const theme = ghosttyPaletteToTheme('test', palette);

    expect(theme.colors.accent).toBe('blue');
  });

  it('generates derived surface backgrounds', () => {
    const palette = parseGhosttyTheme(CATPPUCCIN_MOCHA);
    const theme = ghosttyPaletteToTheme('test', palette);

    // Derived colors should be hex strings in vars
    expect(theme.vars!.bgSurface).toMatch(/^#[0-9a-f]{6}$/);
    expect(theme.vars!.bgOverlay).toMatch(/^#[0-9a-f]{6}$/);
    expect(theme.vars!.borderColor).toMatch(/^#[0-9a-f]{6}$/);
  });

  it('handles light themes (high luminance background)', () => {
    const lightContent = `palette = 0=#000000
palette = 1=#cc0000
palette = 2=#00cc00
palette = 3=#cccc00
palette = 4=#0000cc
palette = 5=#cc00cc
palette = 6=#00cccc
palette = 7=#cccccc
palette = 8=#666666
palette = 9=#ff0000
palette = 10=#00ff00
palette = 11=#ffff00
palette = 12=#0000ff
palette = 13=#ff00ff
palette = 14=#00ffff
palette = 15=#ffffff
background = #ffffff
foreground = #000000`;
    const palette = parseGhosttyTheme(lightContent);
    const theme = ghosttyPaletteToTheme('Light Test', palette);

    expect(theme.name).toBe('Light Test');
    for (const token of COLOR_TOKENS) {
      expect(theme.colors[token]).toBeDefined();
    }
  });
});

describe('findGhosttyThemesDir', () => {
  it('returns a string or null', () => {
    const dir = findGhosttyThemesDir();
    expect(dir === null || typeof dir === 'string').toBe(true);
  });
});

describe('listGhosttyThemes', () => {
  it('returns an array', () => {
    const themes = listGhosttyThemes();
    expect(Array.isArray(themes)).toBe(true);
  });

  it('returns sorted theme names if Ghostty is installed', () => {
    const themes = listGhosttyThemes();
    if (themes.length > 1) {
      for (let i = 1; i < themes.length; i++) {
        expect(themes[i] >= themes[i - 1]).toBe(true);
      }
    }
  });
});

describe('loadGhosttyTheme', () => {
  it('returns null for non-existent theme', () => {
    expect(loadGhosttyTheme('This Theme Does Not Exist 12345')).toBeNull();
  });

  it('loads a real Ghostty theme if installed', () => {
    const dir = findGhosttyThemesDir();
    if (!dir) return; // Skip if Ghostty not installed

    const theme = loadGhosttyTheme('Dracula');
    if (!theme) return; // Theme might not exist

    expect(theme.name).toBe('Dracula');
    for (const token of COLOR_TOKENS) {
      expect(theme.colors[token]).toBeDefined();
    }
  });
});

describe('isInsideGhostty', () => {
  const origTermProgram = process.env.TERM_PROGRAM;

  afterEach(() => {
    if (origTermProgram !== undefined) {
      process.env.TERM_PROGRAM = origTermProgram;
    } else {
      delete process.env.TERM_PROGRAM;
    }
  });

  it('returns true when TERM_PROGRAM is ghostty', () => {
    process.env.TERM_PROGRAM = 'ghostty';
    expect(isInsideGhostty()).toBe(true);
  });

  it('returns false when TERM_PROGRAM is something else', () => {
    process.env.TERM_PROGRAM = 'iTerm2';
    expect(isInsideGhostty()).toBe(false);
  });

  it('returns false when TERM_PROGRAM is unset', () => {
    delete process.env.TERM_PROGRAM;
    expect(isInsideGhostty()).toBe(false);
  });
});

describe('readGhosttyConfigTheme', () => {
  it('returns null or a config object', () => {
    const result = readGhosttyConfigTheme();
    if (result !== null) {
      expect(typeof result).toBe('object');
      expect(result.single !== undefined || result.dark !== undefined || result.light !== undefined).toBe(true);
    }
  });
});

describe('detectGhosttyTheme', () => {
  const origTermProgram = process.env.TERM_PROGRAM;

  afterEach(() => {
    if (origTermProgram !== undefined) {
      process.env.TERM_PROGRAM = origTermProgram;
    } else {
      delete process.env.TERM_PROGRAM;
    }
  });

  it('returns null when not inside Ghostty', () => {
    process.env.TERM_PROGRAM = 'iTerm2';
    expect(detectGhosttyTheme()).toBeNull();
  });

  it('returns a string or null when inside Ghostty', () => {
    process.env.TERM_PROGRAM = 'ghostty';
    const result = detectGhosttyTheme();
    expect(result === null || typeof result === 'string').toBe(true);
  });
});
