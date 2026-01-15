/**
 * @license
 * Copyright 2025 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type { SupportedLocale } from './localeDetector.js';

/**
 * Language names for LLM instruction (native name + English in parentheses)
 */
const LANGUAGE_NAMES_FOR_LLM: Record<SupportedLocale, string> = {
  en: 'English',
  'zh-cn': 'Simplified Chinese (简体中文)',
  'zh-tw': 'Traditional Chinese (繁體中文)',
  fr: 'French (Français)',
  de: 'German (Deutsch)',
  it: 'Italian (Italiano)',
  es: 'Spanish (Español)',
  ja: 'Japanese (日本語)',
  ko: 'Korean (한국어)',
  ru: 'Russian (Русский)',
  'pt-br': 'Brazilian Portuguese (Português)',
  tr: 'Turkish (Türkçe)',
  pl: 'Polish (Polski)',
  cs: 'Czech (Čeština)',
  hu: 'Hungarian (Magyar)',
  hi: 'Hindi (हिन्दी)',
};

/**
 * Generate the locale instruction to append to LLM system prompt
 *
 * This instruction tells the LLM to respond in the user's preferred language
 * while keeping code, paths, and technical identifiers in English.
 */
export function buildLocaleInstruction(locale: SupportedLocale): string {
  // No instruction needed for English (default)
  if (locale === 'en') {
    return '';
  }

  const languageName = LANGUAGE_NAMES_FOR_LLM[locale];

  return `
## Response Language Preference

The user has configured their preferred language as **${languageName}**.

Please respond in ${languageName} when providing:
- Explanations and descriptions
- Summaries and overviews
- Conversational responses
- Error explanations
- Suggestions and recommendations

**Keep the following in their original form (usually English):**
- Code snippets and examples
- File paths and directory names
- Command names and CLI flags
- Technical identifiers (function names, variables, etc.)
- JSON output format and tool call parameters
- Error messages from tools (but you may add translated explanations)

**Code comments:** If the project already uses ${languageName} comments, continue in ${languageName}. Otherwise, use English for consistency with the codebase.
`;
}

/**
 * Inject locale instruction into the system prompt
 *
 * Should be called at the end of buildSystemPrompt() in agent.ts
 * to append the locale preference instruction.
 */
export function injectLocaleIntoPrompt(systemPrompt: string, locale: SupportedLocale): string {
  const localeInstruction = buildLocaleInstruction(locale);

  if (!localeInstruction) {
    return systemPrompt;
  }

  return systemPrompt + '\n' + localeInstruction;
}
