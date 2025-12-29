/**
 * @license
 * Copyright 2025 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * All available color tokens in the theme system.
 * Each token represents a semantic color role in the UI.
 */
export type ColorToken =
  // Core UI (10 tokens)
  | 'accent'
  | 'border'
  | 'borderAccent'
  | 'borderMuted'
  | 'success'
  | 'error'
  | 'warning'
  | 'muted'
  | 'dim'
  | 'text'
  // Backgrounds & Content (7 tokens)
  | 'userMessageBg'
  | 'userMessageText'
  | 'toolPendingBg'
  | 'toolSuccessBg'
  | 'toolErrorBg'
  | 'toolTitle'
  | 'toolOutput'
  // Diff Colors (3 tokens)
  | 'diffAdded'
  | 'diffRemoved'
  | 'diffContext'
  // Syntax Highlighting (9 tokens)
  | 'syntaxComment'
  | 'syntaxKeyword'
  | 'syntaxFunction'
  | 'syntaxVariable'
  | 'syntaxString'
  | 'syntaxNumber'
  | 'syntaxType'
  | 'syntaxOperator'
  | 'syntaxPunctuation'
  // Markdown (10 tokens)
  | 'mdHeading'
  | 'mdLink'
  | 'mdLinkUrl'
  | 'mdCode'
  | 'mdCodeBlock'
  | 'mdCodeBlockBorder'
  | 'mdQuote'
  | 'mdQuoteBorder'
  | 'mdHr'
  | 'mdListBullet';

/**
 * Color value can be:
 * - Hex color: '#rrggbb' or '#rgb'
 * - 256-color palette index: 0-255
 * - Variable reference: name from vars section
 * - Empty string: inherit terminal default
 */
export type ColorValue = string | number;

/**
 * Complete set of theme colors.
 * All tokens are required for a valid theme.
 */
export interface ThemeColors {
  // Core UI
  accent: ColorValue;
  border: ColorValue;
  borderAccent: ColorValue;
  borderMuted: ColorValue;
  success: ColorValue;
  error: ColorValue;
  warning: ColorValue;
  muted: ColorValue;
  dim: ColorValue;
  text: ColorValue;
  // Backgrounds & Content
  userMessageBg: ColorValue;
  userMessageText: ColorValue;
  toolPendingBg: ColorValue;
  toolSuccessBg: ColorValue;
  toolErrorBg: ColorValue;
  toolTitle: ColorValue;
  toolOutput: ColorValue;
  // Diff Colors
  diffAdded: ColorValue;
  diffRemoved: ColorValue;
  diffContext: ColorValue;
  // Syntax Highlighting
  syntaxComment: ColorValue;
  syntaxKeyword: ColorValue;
  syntaxFunction: ColorValue;
  syntaxVariable: ColorValue;
  syntaxString: ColorValue;
  syntaxNumber: ColorValue;
  syntaxType: ColorValue;
  syntaxOperator: ColorValue;
  syntaxPunctuation: ColorValue;
  // Markdown
  mdHeading: ColorValue;
  mdLink: ColorValue;
  mdLinkUrl: ColorValue;
  mdCode: ColorValue;
  mdCodeBlock: ColorValue;
  mdCodeBlockBorder: ColorValue;
  mdQuote: ColorValue;
  mdQuoteBorder: ColorValue;
  mdHr: ColorValue;
  mdListBullet: ColorValue;
}

/**
 * Partial theme colors for custom themes that only override some values.
 */
export type PartialThemeColors = Partial<ThemeColors>;

/**
 * Theme definition as stored in JSON files.
 */
export interface ThemeDefinition {
  /** Theme name (e.g., 'dark', 'light', 'solarized') */
  name: string;
  /** Variable definitions for color reuse */
  vars?: Record<string, ColorValue>;
  /** Color token values */
  colors: PartialThemeColors;
}

/**
 * Resolved theme with all colors converted to usable values.
 */
export interface ResolvedTheme {
  name: string;
  colors: ResolvedColors;
}

/**
 * All colors resolved to their final string representation.
 */
export type ResolvedColors = Record<ColorToken, string>;

/**
 * Terminal color capabilities.
 */
export type ColorMode = 'truecolor' | '256' | '16' | 'none';

/**
 * List of all color tokens for validation.
 */
export const COLOR_TOKENS: readonly ColorToken[] = [
  // Core UI
  'accent',
  'border',
  'borderAccent',
  'borderMuted',
  'success',
  'error',
  'warning',
  'muted',
  'dim',
  'text',
  // Backgrounds & Content
  'userMessageBg',
  'userMessageText',
  'toolPendingBg',
  'toolSuccessBg',
  'toolErrorBg',
  'toolTitle',
  'toolOutput',
  // Diff Colors
  'diffAdded',
  'diffRemoved',
  'diffContext',
  // Syntax Highlighting
  'syntaxComment',
  'syntaxKeyword',
  'syntaxFunction',
  'syntaxVariable',
  'syntaxString',
  'syntaxNumber',
  'syntaxType',
  'syntaxOperator',
  'syntaxPunctuation',
  // Markdown
  'mdHeading',
  'mdLink',
  'mdLinkUrl',
  'mdCode',
  'mdCodeBlock',
  'mdCodeBlockBorder',
  'mdQuote',
  'mdQuoteBorder',
  'mdHr',
  'mdListBullet',
] as const;

/**
 * Check if a string is a valid color token.
 */
export function isColorToken(value: string): value is ColorToken {
  return COLOR_TOKENS.includes(value as ColorToken);
}

/**
 * Check if a value is a valid hex color.
 */
export function isHexColor(value: unknown): boolean {
  if (typeof value !== 'string') return false;
  return /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(value);
}

/**
 * Check if a value is a valid 256-color index.
 */
export function is256ColorIndex(value: unknown): boolean {
  return typeof value === 'number' && value >= 0 && value <= 255 && Number.isInteger(value);
}

/**
 * Check if a value is a valid color value (hex, 256-index, empty, or string variable).
 */
export function isValidColorValue(value: unknown): value is ColorValue {
  if (value === '') return true; // Terminal default
  if (isHexColor(value)) return true;
  if (is256ColorIndex(value)) return true;
  if (typeof value === 'string' && value.length > 0) return true; // Variable reference
  return false;
}
