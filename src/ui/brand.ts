import { detectColorMode } from './theme/Theme.js';
import type { ColorMode } from './theme/types.js';
import { AUTOHAND_LOGO_FRAME_COUNT, AUTOHAND_LOGO_FPS } from '../utils/autohandLogoData.js';

export const BRAND_FRAME_INTERVAL_MS = 1_000 / AUTOHAND_LOGO_FPS;
export const BRAND_FRAME_COUNT = AUTOHAND_LOGO_FRAME_COUNT;

export function resolveBrandColorMode(isTTY: boolean): ColorMode {
  if (!isTTY || process.env.TERM === 'dumb') return 'none';
  return detectColorMode();
}

export function shouldAnimateBrand(isTTY: boolean, _colorMode: ColorMode, animate = true): boolean {
  return animate && isTTY && process.env.TERM !== 'dumb' && process.env.AUTOHAND_REDUCED_MOTION !== '1';
}

export function formatBrandLogo(art: string, _frame = 0, _colorMode?: ColorMode): string {
  return art;
}
