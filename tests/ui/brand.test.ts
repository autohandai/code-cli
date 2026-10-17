import { afterEach, describe, expect, it, vi } from 'vitest';
import stripAnsi from 'strip-ansi';
import { renderAutohandLogo } from '../../src/utils/asciiArt.js';
import { formatBrandLogo, resolveBrandColorMode, shouldAnimateBrand } from '../../src/ui/brand.js';
import { BRAND_FRAME_COUNT } from '../../src/ui/brand.js';

afterEach(() => vi.unstubAllEnvs());

describe('portable monochrome brand rendering', () => {
  it.each(['truecolor', '256', '16', 'none'] as const)('inherits the unmodified terminal foreground in %s mode', (mode) => {
    const art = '  ⢀⣀⣀⡀ ·\n  ⠈⠉⠉⠁ ●';
    expect(formatBrandLogo(art, 0, mode)).toBe(art);
    expect(formatBrandLogo(art, 20, mode)).toBe(art);
  });

  it('keeps a monochrome terminal animation moving when NO_COLOR disables ANSI colour', () => {
    vi.stubEnv('TERM', 'xterm-256color');
    vi.stubEnv('NO_COLOR', '1');
    vi.stubEnv('AUTOHAND_REDUCED_MOTION', undefined);
    expect(shouldAnimateBrand(true, 'none')).toBe(true);
    vi.stubEnv('TERM', 'dumb');
    expect(shouldAnimateBrand(true, 'none')).toBe(false);
  });

  it('preserves visible geometry animation without changing terminal colour or intensity', () => {
    const firstArt = renderAutohandLogo({ columns: 80, rows: 16, frame: 0 });
    const laterArt = renderAutohandLogo({ columns: 80, rows: 16, frame: 20 });
    const first = formatBrandLogo(firstArt, 0, 'truecolor');
    const later = formatBrandLogo(laterArt, 20, 'truecolor');
    expect(first).not.toBe(later);
    expect(first).toBe(firstArt);
    expect(later).toBe(laterArt);
    expect(first + later).not.toContain('\x1b');
  });

  it.each(['256', '16', 'none'] as const)('degrades to %s colour without altering geometry', (mode) => {
    const art = '.+#@ .+#@';
    const frame = formatBrandLogo(art, 3, mode);
    expect(stripAnsi(frame)).toBe(art);
    expect(frame).not.toContain(';2;');
    expect(frame).toBe(art);
  });

  it('respects NO_COLOR, redirected output, and dumb terminals', () => {
    vi.stubEnv('FORCE_COLOR', '3');
    expect(resolveBrandColorMode(false)).toBe('none');
    vi.stubEnv('TERM', 'dumb');
    expect(resolveBrandColorMode(true)).toBe('none');
    vi.stubEnv('TERM', 'xterm-256color');
    vi.stubEnv('NO_COLOR', '');
    expect(resolveBrandColorMode(true)).toBe('none');
  });

  it('honours reduced motion and explicit static presentation', () => {
    expect(shouldAnimateBrand(true, 'truecolor', true)).toBe(true);
    expect(shouldAnimateBrand(false, 'truecolor', true)).toBe(false);
    expect(shouldAnimateBrand(true, 'none', true)).toBe(true);
    expect(shouldAnimateBrand(true, 'truecolor', false)).toBe(false);
    vi.stubEnv('AUTOHAND_REDUCED_MOTION', '1');
    expect(shouldAnimateBrand(true, 'truecolor', true)).toBe(false);
  });

  it('keeps the foreground stable and leaves whitespace untouched', () => {
    const art = '  # #  \n  + +  ';
    expect(formatBrandLogo(art, 0, '256')).toBe(formatBrandLogo(art, BRAND_FRAME_COUNT, '256'));
    expect(stripAnsi(formatBrandLogo(art, 47, '256'))).toBe(art);
  });
});
