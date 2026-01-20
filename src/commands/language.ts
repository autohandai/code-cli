/**
 * @license
 * Copyright 2025 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import chalk from 'chalk';
import enquirer from 'enquirer';
import type { LoadedConfig } from '../types.js';
import { saveConfig } from '../config.js';
import {
  changeLanguage,
  getCurrentLocale,
  t,
  SUPPORTED_LOCALES,
  LANGUAGE_DISPLAY_NAMES,
  type SupportedLocale,
} from '../i18n/index.js';

interface LanguageContext {
  config: LoadedConfig;
}

/**
 * Language command - prompts user to select a display language
 */
export async function language(ctx: LanguageContext): Promise<string | null> {
  const { Select } = enquirer as any;

  const currentLocale = getCurrentLocale();
  const currentDisplayName = LANGUAGE_DISPLAY_NAMES[currentLocale];

  console.log(chalk.cyan(`\n🌐 ${t('commands.language.title')}\n`));
  console.log(chalk.gray(`${t('commands.language.currentLanguage', { language: currentDisplayName })}`));
  console.log();

  const choices = SUPPORTED_LOCALES.map((locale) => ({
    name: locale,
    message: locale === currentLocale
      ? `${LANGUAGE_DISPLAY_NAMES[locale]} (${t('common.current')})`
      : LANGUAGE_DISPLAY_NAMES[locale],
  }));

  try {
    const prompt = new Select({
      name: 'locale',
      message: t('commands.language.selectPrompt'),
      choices,
      initial: SUPPORTED_LOCALES.indexOf(currentLocale),
    });

    const selected = (await prompt.run()) as SupportedLocale;

    if (selected === currentLocale) {
      console.log(chalk.gray(`\n${t('commands.language.noChange')}`));
      return null;
    }

    // Update i18n runtime
    await changeLanguage(selected);

    // Update config and persist
    ctx.config.ui = { ...ctx.config.ui, locale: selected };
    await saveConfig(ctx.config);

    // Show success message in the NEW language
    const newDisplayName = LANGUAGE_DISPLAY_NAMES[selected];
    console.log(chalk.green(`\n✓ ${t('commands.language.changed', { language: newDisplayName })}`));
    console.log();

    return null;
  } catch {
    // User cancelled
    console.log(chalk.gray('\nLanguage selection cancelled.'));
    return null;
  }
}

/**
 * Display current language info
 */
export async function languageInfo(): Promise<string | null> {
  const currentLocale = getCurrentLocale();
  const currentDisplayName = LANGUAGE_DISPLAY_NAMES[currentLocale];

  console.log(chalk.cyan(`\n🌐 ${t('commands.language.title')}\n`));
  console.log(chalk.gray(`${t('commands.language.currentLanguage', { language: currentDisplayName })}`));
  console.log(chalk.gray(`Locale code: ${chalk.white(currentLocale)}`));
  console.log();

  console.log(chalk.gray('Supported languages:'));
  for (const locale of SUPPORTED_LOCALES) {
    const marker = locale === currentLocale ? chalk.green('●') : chalk.gray('○');
    console.log(`  ${marker} ${LANGUAGE_DISPLAY_NAMES[locale]}`);
  }
  console.log();

  return null;
}

export const metadata = {
  command: '/language',
  description: 'change display language',
  implemented: true,
};
