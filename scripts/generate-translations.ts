/**
 * AI Translation Generator for Autohand CLI
 *
 * Uses OpenRouter API to generate translations from English source.
 * Run: bun scripts/generate-translations.ts
 *
 * Environment variables:
 *   OPENROUTER_API_KEY - Required for API access
 *   TRANSLATION_MODEL - Optional, defaults to anthropic/claude-sonnet-4-20250514
 *
 * @license
 * Copyright 2025 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import fs from 'fs-extra';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY;
const BASE_URL = 'https://openrouter.ai/api/v1';
const MODEL = process.env.TRANSLATION_MODEL || 'anthropic/claude-sonnet-4-20250514';

const SOURCE_LOCALE = 'en';
const TARGET_LOCALES = [
  'zh-cn',
  'zh-tw',
  'fr',
  'de',
  'it',
  'es',
  'ja',
  'ko',
  'ru',
  'pt-br',
  'tr',
  'pl',
  'cs',
  'hu',
  'hi',
];

const LANGUAGE_NAMES: Record<string, string> = {
  'zh-cn': 'Simplified Chinese',
  'zh-tw': 'Traditional Chinese',
  fr: 'French',
  de: 'German',
  it: 'Italian',
  es: 'Spanish',
  ja: 'Japanese',
  ko: 'Korean',
  ru: 'Russian',
  'pt-br': 'Brazilian Portuguese',
  tr: 'Turkish',
  pl: 'Polish',
  cs: 'Czech',
  hu: 'Hungarian',
  hi: 'Hindi',
};

const LOCALES_DIR = path.join(__dirname, '../src/i18n/locales');

interface TranslationRequest {
  sourceLocale: string;
  targetLocale: string;
  sourceStrings: Record<string, unknown>;
}

async function translateWithLLM(
  request: TranslationRequest
): Promise<Record<string, unknown>> {
  const { targetLocale, sourceStrings } = request;

  const targetLanguage = LANGUAGE_NAMES[targetLocale] || targetLocale;

  const prompt = `You are a professional translator specializing in software localization.`
    + `Translate the following JSON from English to ${targetLanguage}.`

    + `\n\nIMPORTANT RULES:`
    + `1. Preserve all JSON structure, keys, and interpolation variables (e.g., {{variable}})`
    + `2. Preserve technical terms, file paths, command names, and code references`
    + `3. Translate only the string values, not the keys`
    + `4. Maintain the same level of formality and tone`
    + `5. For CLI tools, use appropriate technical terminology in ${targetLanguage}`
    + `6. Return ONLY valid JSON, no explanations or markdown fencing`

    + `\n\nSource JSON:`
    + `${JSON.stringify(sourceStrings, null, 2)}`

    + `\n\nTranslated JSON:`;

  const response = await fetch(`${BASE_URL}/chat/completions`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${OPENROUTER_API_KEY}`,
      'Content-Type': 'application/json',
      'HTTP-Referer': 'https://autohand.ai',
      'X-Title': 'Autohand CLI Translation Generator',
    },
    body: JSON.stringify({
      model: MODEL,
      messages: [{ role: 'user', content: prompt }],
      temperature: 0.1, // Low temperature for consistency
      max_tokens: 16000,
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`API error: ${response.status} ${response.statusText}\n${errorText}`);
  }

  const data = (await response.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
  };
  const content = data.choices?.[0]?.message?.content;

  if (!content) {
    throw new Error('No content in API response');
  }

  // Extract JSON from response (handle potential markdown fencing)
  let jsonStr = content.trim();

  // Remove markdown code fences if present
  if (jsonStr.startsWith('```json')) {
    jsonStr = jsonStr.slice(7);
  } else if (jsonStr.startsWith('```')) {
    jsonStr = jsonStr.slice(3);
  }
  if (jsonStr.endsWith('```')) {
    jsonStr = jsonStr.slice(0, -3);
  }
  jsonStr = jsonStr.trim();

  try {
    return JSON.parse(jsonStr);
  } catch (e) {
    console.error(`Failed to parse JSON for ${targetLocale}:`, jsonStr.slice(0, 500));
    throw new Error(`Invalid JSON response for ${targetLocale}: ${(e as Error).message}`);
  }
}

function countKeys(obj: Record<string, unknown>, prefix = ''): number {
  let count = 0;
  for (const [key, value] of Object.entries(obj)) {
    if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
      count += countKeys(value as Record<string, unknown>, `${prefix}${key}.`);
    } else {
      count++;
    }
  }
  return count;
}

async function generateTranslations() {
  console.log('\ud83c\udf10 Autohand CLI Translation Generator\n');

  if (!OPENROUTER_API_KEY) {
    console.error('\u274c Error: OPENROUTER_API_KEY environment variable is required');
    console.error('   Set it with: export OPENROUTER_API_KEY="sk-or-..."');
    process.exit(1);
  }

  console.log(`\ud83d\udce1 Using model: ${MODEL}`);
  console.log(`\ud83d\udcc1 Locales directory: ${LOCALES_DIR}\n`);

  // Ensure locales directory exists
  await fs.ensureDir(LOCALES_DIR);

  // Load source locale
  const sourcePath = path.join(LOCALES_DIR, `${SOURCE_LOCALE}.json`);

  if (!(await fs.pathExists(sourcePath))) {
    console.error(`\u274c Error: Source locale file not found: ${sourcePath}`);
    process.exit(1);
  }

  const sourceStrings = await fs.readJson(sourcePath);
  const keyCount = countKeys(sourceStrings);

  console.log(`\udcd6 Loaded source locale: ${SOURCE_LOCALE}`);
  console.log(`\ud83d\udcca Total keys to translate: ${keyCount}`);
  console.log(`\ud83c\udfaf Target locales: ${TARGET_LOCALES.length}\n`);

  const results: { locale: string; status: 'success' | 'failed'; error?: string }[] = [];

  for (const targetLocale of TARGET_LOCALES) {
    const targetPath = path.join(LOCALES_DIR, `${targetLocale}.json`);
    const languageName = LANGUAGE_NAMES[targetLocale] || targetLocale;

    console.log(`\ud83d\udd04 Translating to ${languageName} (${targetLocale})...`);

    try {
      // Translate
      const translated = await translateWithLLM({
        sourceLocale: SOURCE_LOCALE,
        targetLocale,
        sourceStrings,
      });

      // Validate key count matches
      const translatedKeyCount = countKeys(translated);
      if (translatedKeyCount !== keyCount) {
        console.warn(
          `   \u26a0\ufe0f  Key count mismatch: expected ${keyCount}, got ${translatedKeyCount}`
        );
      }

      // Write to file
      await fs.writeJson(targetPath, translated, { spaces: 2 });

      console.log(`   \u2705 Written to ${path.basename(targetPath)}`);
      results.push({ locale: targetLocale, status: 'success' });

      // Rate limiting - wait between requests to avoid hitting limits
      if (TARGET_LOCALES.indexOf(targetLocale) < TARGET_LOCALES.length - 1) {
        console.log('   \u23f3 Waiting 2 seconds before next translation...');
        await new Promise((resolve) => setTimeout(resolve, 2000));
      }
    } catch (error) {
      const errorMessage = (error as Error).message;
      console.error(`   \u274c Failed: ${errorMessage}`);
      results.push({ locale: targetLocale, status: 'failed', error: errorMessage });
    }
  }

  // Summary
  console.log('\n\ud83d\udcca Translation Summary:');
  console.log('\u2500'.repeat(50));

  const successful = results.filter((r) => r.status === 'success');
  const failed = results.filter((r) => r.status === 'failed');

  console.log(`   \u2705 Successful: ${successful.length}`);
  console.log(`   \u274c Failed: ${failed.length}`);

  if (failed.length > 0) {
    console.log('\n   Failed locales:');
    for (const f of failed) {
      console.log(`     - ${f.locale}: ${f.error}`);
    }
  }

  console.log('\n\u2728 Translation generation complete!');

  if (failed.length > 0) {
    process.exit(1);
  }
}

// Run the script
generateTranslations().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});