/**
 * @license
 * Copyright 2025 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import chalk from 'chalk';
import { t } from '../i18n/index.js';
import { showModal, type ModalOption } from '../ui/ink/components/Modal.js';
import { listAvailableThemes, initTheme, getTheme, isThemeInitialized, CUSTOM_THEMES_DIR } from '../ui/theme/index.js';
import type { LoadedConfig } from '../types.js';
import { saveConfig } from '../config.js';

interface ThemeContext {
  config: LoadedConfig;
}

/**
 * Theme command - prompts user to select a theme
 */
export async function theme(ctx: ThemeContext): Promise<string | null> {
  const themes = listAvailableThemes();
  const currentTheme = isThemeInitialized() ? getTheme().name : (ctx.config.ui?.theme || 'dark');

  console.log(chalk.cyan(`\n🎨 ${t('commands.theme.title')}\n`));
  console.log(chalk.gray(t('commands.theme.currentTheme', { theme: chalk.white(currentTheme) })));
  console.log(chalk.gray(`Custom themes location: ${CUSTOM_THEMES_DIR}\n`));

  const descriptions: Record<string, string> = {
    dark: 'Default dark theme',
    light: 'Light terminal backgrounds',
    dracula: 'Vibrant Dracula palette',
    sandy: 'Warm, earthy desert tones',
    tui: 'New Zealand-inspired colors',
    'github-dark': 'GitHub Dark terminal palette',
  };

  const options: ModalOption[] = themes.map(name => ({
    label: name === currentTheme ? `${name} (current)` : name,
    value: name,
    description: descriptions[name] ?? 'Custom theme',
  }));

  const result = await showModal({
    title: t('commands.theme.selectPrompt'),
    options,
    initialIndex: themes.indexOf(currentTheme)
  });

  if (!result) {
    console.log(chalk.gray('\nTheme selection cancelled.'));
    return null;
  }

  const selected = result.value;

  if (selected === currentTheme) {
    console.log(chalk.gray(`\n${t('commands.theme.noChange')}`));
    return null;
  }

  // Initialize the new theme
  initTheme(selected);

  // Update config
  ctx.config.ui = { ...ctx.config.ui, theme: selected };
  await saveConfig(ctx.config);

  console.log(chalk.green(`\n✓ ${t('commands.theme.changed', { theme: selected })}`));

  // Show preview of theme colors
  const newTheme = getTheme();
  console.log('\nTheme preview:');
  console.log(`  ${newTheme.fg('accent', '● accent')}  ${newTheme.fg('success', '● success')}  ${newTheme.fg('error', '● error')}  ${newTheme.fg('warning', '● warning')}`);
  console.log(`  ${newTheme.fg('muted', '● muted')}  ${newTheme.fg('dim', '● dim')}  ${newTheme.fg('text', '● text')}`);
  console.log();

  return null;
}

/**
 * Display current theme info
 */
export async function themeInfo(): Promise<string | null> {
  if (!isThemeInitialized()) {
    console.log(chalk.yellow('Theme not initialized.'));
    return null;
  }

  const currentTheme = getTheme();
  console.log(chalk.cyan('\n🎨 Current Theme Info\n'));
  console.log(chalk.gray(`Name: ${chalk.white(currentTheme.name)}`));
  console.log(chalk.gray(`Color mode: ${chalk.white(currentTheme.getColorMode())}`));
  console.log(chalk.gray(`Custom themes dir: ${CUSTOM_THEMES_DIR}`));
  console.log();

  // Show color preview
  console.log('Color preview:');
  console.log(`  ${currentTheme.fg('accent', '● accent')}  ${currentTheme.fg('success', '● success')}  ${currentTheme.fg('error', '● error')}  ${currentTheme.fg('warning', '● warning')}`);
  console.log(`  ${currentTheme.fg('muted', '● muted')}  ${currentTheme.fg('dim', '● dim')}  ${currentTheme.fg('text', '● text')}`);
  console.log();
  console.log('Syntax colors:');
  console.log(`  ${currentTheme.fg('syntaxKeyword', 'keyword')}  ${currentTheme.fg('syntaxString', '"string"')}  ${currentTheme.fg('syntaxNumber', '42')}  ${currentTheme.fg('syntaxComment', '// comment')}`);
  console.log(`  ${currentTheme.fg('syntaxFunction', 'function')}  ${currentTheme.fg('syntaxType', 'Type')}  ${currentTheme.fg('syntaxVariable', 'variable')}`);
  console.log();
  console.log('Diff colors:');
  console.log(`  ${currentTheme.fg('diffAdded', '+ added')}  ${currentTheme.fg('diffRemoved', '- removed')}  ${currentTheme.fg('diffContext', '  context')}`);
  console.log();

  return null;
}

export const metadata = {
  command: '/theme',
  description: t('commands.theme.description'),
  implemented: true
};
