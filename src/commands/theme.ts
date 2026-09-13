/**
 * @license
 * Copyright 2025 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import chalk from 'chalk';
import { t } from '../i18n/index.js';
import { showModal, type ModalOption } from '../ui/ink/components/Modal.js';
import { listAvailableThemes, initTheme, getTheme, isThemeInitialized, CUSTOM_THEMES_DIR } from '../ui/theme/index.js';
import { builtInThemes, getDefaultThemeName } from '../ui/theme/themes.js';
import type { LoadedConfig } from '../types.js';
import { saveConfig } from '../config.js';

interface ThemeContext {
  config: LoadedConfig;
  onBeforeModal?: () => Promise<void> | void;
  onAfterModal?: () => Promise<void> | void;
}

/**
 * Theme command - prompts user to select a theme
 */
export async function theme(ctx: ThemeContext): Promise<string | null> {
  const themes = listAvailableThemes();
  const currentTheme = isThemeInitialized() ? getTheme().name : (ctx.config.ui?.theme || getDefaultThemeName());

  console.log(chalk.cyan(`\n🎨 ${t('commands.theme.title')}\n`));
  console.log(chalk.gray(t('commands.theme.currentTheme', { theme: chalk.white(currentTheme) })));
  console.log(chalk.gray(`Custom themes location: ${CUSTOM_THEMES_DIR}\n`));

  const descriptions: Record<string, string> = {
    // Built-in
    aurora: 'Default theme with charcoal, cool neutrals, and soft periwinkle',
    dark: 'Classic dark theme',
    light: 'Light terminal backgrounds',
    dracula: 'Vibrant Dracula palette',
    sandy: 'Warm, earthy desert tones',
    tui: 'New Zealand-inspired colors',
    tuatara: 'Tuatara-inspired lichen, warm stone, and soft amber',
    'github-dark': 'GitHub Dark terminal palette',
    cappadocia: 'Cappadocia-inspired rose valleys, dawn sky, and balloon colors',
    rio: 'Rio-inspired blue macaw, rainforest, and beach-light palette',
    australia: 'Australian coast, wattle, and eucalyptus palette',
    // Curated Ghostty themes
    'Atom One Dark': 'Atom editor dark theme',
    'Ayu Mirage': 'Soft dark with warm accents',
    'Catppuccin Frappe': 'Soothing pastel dark',
    'Catppuccin Latte': 'Soothing pastel light',
    'Catppuccin Macchiato': 'Soothing pastel medium dark',
    'Catppuccin Mocha': 'Soothing pastel deep dark',
    'Everforest Dark Hard': 'Comfortable green-tinted dark',
    'Gruvbox Dark': 'Retro groove warm dark',
    'Gruvbox Light': 'Retro groove warm light',
    'Kanagawa Wave': 'Dark with Japanese wave palette',
    'Monokai Pro': 'Modern Monokai refined',
    'Nord': 'Arctic, north-bluish palette',
    'One Half Dark': 'Clean dark balanced colors',
    'Rose Pine': 'All-natural pine dark',
    'Rose Pine Dawn': 'All-natural pine light',
    'Rose Pine Moon': 'All-natural pine dimmed dark',
    'Solarized Osaka Night': 'Solarized meets Osaka nights',
    'TokyoNight': 'Clean dark with vivid colors',
    'TokyoNight Storm': 'Storm variant with blue tints',
  };

  const options: ModalOption[] = themes.map(name => {
    const label = name === currentTheme ? `${name} (current)` : name;
    const description = descriptions[name]
      ?? (name in builtInThemes ? 'Built-in theme' : 'Ghostty theme');
    return { label, value: name, description };
  });

  let result: ModalOption | null = null;
  let selectedTheme: string | null = null;
  let selectedThemePreview: ReturnType<typeof getTheme> | null = null;

  await ctx.onBeforeModal?.();
  try {
    result = await showModal({
      title: t('commands.theme.selectPrompt'),
      options,
      initialIndex: themes.indexOf(currentTheme)
    });

    if (result) {
      const selected = result.value;

      if (selected !== currentTheme) {
        selectedThemePreview = initTheme(selected);

        // Update config
        ctx.config.ui = { ...ctx.config.ui, theme: selected };
        await saveConfig(ctx.config);
        selectedTheme = selected;
      }
    }
  } finally {
    await ctx.onAfterModal?.();
  }

  if (!result) {
    console.log(chalk.gray('\nTheme selection cancelled.'));
    return null;
  }

  const selected = result.value;

  if (selected === currentTheme) {
    console.log(chalk.gray(`\n${t('commands.theme.noChange')}`));
    return null;
  }

  console.log(chalk.green(`\n✓ ${t('commands.theme.changed', { theme: selectedTheme ?? selected })}`));

  // Show preview of theme colors
  const newTheme = selectedThemePreview ?? getTheme();
  console.log('\nTheme preview:');
  console.log(`  ${newTheme.fg('accent', '● accent')}  ${newTheme.fg('success', '● success')}  ${newTheme.fg('error', '● error')}  ${newTheme.fg('warning', '● warning')}`);
  console.log(`  ${newTheme.fg('muted', '● muted')}  ${newTheme.fg('dim', '● dim')}  ${newTheme.fg('text', '● text')}`);
  if (newTheme.getColorMode() === 'none') {
    console.log(chalk.yellow('  Color output is disabled by NO_COLOR or FORCE_COLOR=0 in your terminal environment.'));
  }
  console.log();

  return null;
}

export const metadata = {
  command: '/theme',
  description: t('commands.theme.description'),
  implemented: true
};
