/**
 * @license
 * Copyright 2025 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import chalk from 'chalk';
import enquirer from 'enquirer';
import { configureSearch, getSearchConfig } from '../actions/web.js';
import { saveConfig } from '../config.js';
import type { LoadedConfig, SearchProvider } from '../types.js';

interface SearchContext {
  config?: LoadedConfig;
}

/**
 * Web search configuration command
 * Allows users to select and configure their web search provider
 */
export async function search(ctx: SearchContext): Promise<string | null> {
  const currentConfig = getSearchConfig();
  const config = ctx.config;

  console.log(chalk.bold('\nWeb Search Configuration\n'));
  console.log(chalk.gray(`Current provider: ${chalk.cyan(currentConfig.provider)}`));

  // Check API key status
  const braveKeySet = !!(currentConfig.braveApiKey || process.env.BRAVE_SEARCH_API_KEY);
  const parallelKeySet = !!(currentConfig.parallelApiKey || process.env.PARALLEL_API_KEY);

  console.log(chalk.gray(`Brave API key: ${braveKeySet ? chalk.green('configured') : chalk.yellow('not set')}`));
  console.log(chalk.gray(`Parallel API key: ${parallelKeySet ? chalk.green('configured') : chalk.yellow('not set')}`));
  console.log();

  // Provider selection
  const providerChoices = [
    {
      name: 'duckduckgo',
      message: `DuckDuckGo ${chalk.gray('(no API key required, may be blocked by CAPTCHA)')}`
    },
    {
      name: 'brave',
      message: `Brave Search ${chalk.gray('(requires API key)')} ${braveKeySet ? chalk.green('✓') : ''}`
    },
    {
      name: 'parallel',
      message: `Parallel.ai ${chalk.gray('(requires API key)')} ${parallelKeySet ? chalk.green('✓') : ''}`
    }
  ];

  try {
    const { provider } = await enquirer.prompt<{ provider: SearchProvider }>({
      type: 'select',
      name: 'provider',
      message: 'Select search provider:',
      choices: providerChoices,
      initial: providerChoices.findIndex(c => c.name === currentConfig.provider)
    });

    // If selecting a provider that needs an API key, prompt for it
    let braveApiKey = currentConfig.braveApiKey;
    let parallelApiKey = currentConfig.parallelApiKey;

    if (provider === 'brave' && !braveKeySet) {
      console.log(chalk.gray('\nGet your free Brave Search API key at: https://brave.com/search/api/\n'));

      const { apiKey } = await enquirer.prompt<{ apiKey: string }>({
        type: 'password',
        name: 'apiKey',
        message: 'Enter Brave Search API key:',
      });

      if (apiKey.trim()) {
        braveApiKey = apiKey.trim();
      } else {
        console.log(chalk.yellow('No API key entered. Brave Search will not work without an API key.'));
        return null;
      }
    }

    if (provider === 'parallel' && !parallelKeySet) {
      console.log(chalk.gray('\nGet your Parallel.ai API key at: https://platform.parallel.ai\n'));

      const { apiKey } = await enquirer.prompt<{ apiKey: string }>({
        type: 'password',
        name: 'apiKey',
        message: 'Enter Parallel.ai API key:',
      });

      if (apiKey.trim()) {
        parallelApiKey = apiKey.trim();
      } else {
        console.log(chalk.yellow('No API key entered. Parallel.ai Search will not work without an API key.'));
        return null;
      }
    }

    // Update runtime configuration
    configureSearch({
      provider,
      braveApiKey,
      parallelApiKey,
    });

    // Save to config file
    if (config) {
      config.search = {
        provider,
        braveApiKey,
        parallelApiKey,
      };
      await saveConfig(config);
      console.log(chalk.green(`\n✓ Search provider set to ${provider} and saved to config`));
    } else {
      console.log(chalk.green(`\n✓ Search provider set to ${provider} (session only)`));
    }

    // Show provider-specific info
    switch (provider) {
      case 'duckduckgo':
        console.log(chalk.gray('Note: DuckDuckGo may block automated requests with a CAPTCHA.'));
        break;
      case 'brave':
        console.log(chalk.gray('Brave Search is now active. Free tier allows 2,000 queries/month.'));
        break;
      case 'parallel':
        console.log(chalk.gray('Parallel.ai Search is now active with deep research capabilities.'));
        break;
    }

    return null;
  } catch (error) {
    // User cancelled
    if ((error as any)?.message?.includes('cancelled') || (error as any)?.code === 'ERR_USE_AFTER_CLOSE') {
      console.log(chalk.gray('Search configuration cancelled.'));
      return null;
    }
    throw error;
  }
}

export const metadata = {
  command: '/search',
  description: 'configure web search provider (brave, duckduckgo, parallel)',
  implemented: true,
};
