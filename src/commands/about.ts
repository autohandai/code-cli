/**
 * @license
 * Copyright 2025 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { execSync } from 'node:child_process';
import chalk from 'chalk';
import terminalLink from 'terminal-link';
import { t } from '../i18n/index.js';
import { getTheme, isThemeInitialized } from '../ui/theme/Theme.js';
import packageJson from '../../package.json' with { type: 'json' };

/**
 * Get git commit hash (short)
 */
function getGitCommit(): string {
  // Use build-time embedded commit if available
  if (process.env.BUILD_GIT_COMMIT && process.env.BUILD_GIT_COMMIT !== 'undefined') {
    return process.env.BUILD_GIT_COMMIT;
  }
  // Fallback for development (running from source)
  try {
    return execSync('git rev-parse --short HEAD', { encoding: 'utf8', stdio: ['pipe', 'pipe', 'ignore'] }).trim();
  } catch {
    return 'unknown';
  }
}

/**
 * Get full version string with git commit
 */
function getVersionString(): string {
  const commit = getGitCommit();
  return commit !== 'unknown' ? `${packageJson.version} (${commit})` : packageJson.version;
}

// ASCII art from welcome banner
const ASCII_FRIEND = [
  '⢀⡴⠛⠛⠻⣷⡄⠀⣠⡶⠟⠛⠻⣶⡄⢀⣴⡾⠛⠛⢿⣦⠀⢀⣴⠞⠛⠛⠶⡀',
  '⡎⠀⢰⣶⡆⠈⣿⣴⣿⠁⣴⣶⡄⠘⣿⣾⡏⢀⣶⣦⠀⢻⡇⣿⠃⢠⣶⡆⠀⢹',
  '⢧⠀⠘⠛⠃⢠⡿⠙⣿⡀⠙⠛⠃⣰⡿⢻⣧⠈⠛⠛⢀⣾⠇⢻⣆⠈⠛⠋⠀⡼',
  '⠈⠻⢶⣶⡾⠟⠁⠀⠘⠿⢶⣶⡾⠟⠁⠀⠙⠷⣶⣶⠿⠋⠀⠈⠻⠷⣶⡶⠚⠁',
  '⢀⣴⠿⠿⠷⣦⡀⠀⣠⣶⠿⠻⢷⣦⡀⠀⣠⡾⠟⠿⣶⣄⠀⢀⣴⡾⠿⠿⣶⣄',
  '⡾⠃⢠⣤⡄⠘⣿⣠⣿⠁⣠⣤⡄⠹⣷⣼⡏⢀⣤⣤⠈⢿⡆⣾⠏⢀⣤⣄⠈⢿',
  '⢧⡀⠸⠿⠇⢀⣿⠺⣿⡀⠻⠿⠃⢰⣿⢿⣇⠈⠿⠿⠀⣼⡇⢿⣇⠘⠿⠇⠀⣸',
  '⠈⢿⣦⣤⣴⡿⠃⠀⠙⢷⣦⣤⣶⡿⠁⠈⠻⣷⣤⣤⡾⠛⠀⠈⢿⣦⣤⣤⠴⠁'
].join('\n');

/**
 * About command - shows information about Autohand
 */
export async function about(): Promise<string | null> {
  // Use theme if initialized, otherwise use fallback chalk colors
  let accent: (text: string) => string;
  let muted: (text: string) => string;
  let text: (text: string) => string;

  if (isThemeInitialized()) {
    const theme = getTheme();
    accent = (text: string) => chalk.hex(theme.colors.accent)(text);
    muted = (text: string) => chalk.hex(theme.colors.muted)(text);
    text = (str: string) => chalk.hex(theme.colors.text)(str);
  } else {
    // Fallback colors when theme not initialized
    accent = (text: string) => chalk.cyan(text);
    muted = (text: string) => chalk.gray(text);
    text = (text: string) => chalk.white(text);
  }

  // Display ASCII art
  console.log(chalk.gray(ASCII_FRIEND));
  console.log();

  // Title and version
  console.log(accent(`${t('commands.about.title')} v${getVersionString()}`));
  console.log(muted(t('commands.about.subtitle')));
  console.log();

  // Links section - make them underlined and cyan to look clickable
  const websiteUrl = 'https://autohand.ai';
  const githubUrl = 'https://github.com/autohandai/';
  const docsUrl = 'https://docs.autohand.ai';

  const websiteLink = terminalLink(chalk.cyan.underline('autohand.ai'), websiteUrl);
  const githubLink = terminalLink(chalk.cyan.underline('github.com/autohandai/'), githubUrl);
  const docsLink = terminalLink(chalk.cyan.underline('docs.autohand.ai'), docsUrl);

  console.log(`${text('🌐')} ${text(t('commands.about.website') + ':')}    ${websiteLink}`);
  console.log(`${text('📦')} ${text(t('commands.about.github') + ':')}     ${githubLink}`);
  console.log(`${text('📚')} ${text(t('commands.about.docs') + ':')}       ${docsLink}`);
  console.log();

  // Contribution section
  console.log(text(`💡 ${t('commands.about.contribute')}`));
  console.log(text(`   • ${t('commands.about.feedback')}:     ${accent('/feedback')}`));
  console.log(text(`   • ${t('commands.about.submitPR')}:         ${accent('gh pr create')}`));

  const issuesUrl = 'https://github.com/autohandai/code-cli/issues';
  const issuesLink = terminalLink(chalk.cyan.underline('github.com/autohandai/code-cli/issues'), issuesUrl);
  console.log(text(`   • ${t('commands.about.reportIssues')}:     ${issuesLink}`));
  console.log();

  // Footer
  console.log(muted(t('commands.about.pressKey')));
  console.log();

  return null;
}

export const metadata = {
  command: '/about',
  description: 'show information about Autohand',
  implemented: true
};
