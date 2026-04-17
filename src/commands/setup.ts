/**
 * @license
 * Copyright 2025 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import chalk from 'chalk';
import type { SlashCommandContext } from '../core/slashCommandTypes.js';
import { SetupWizard } from '../onboarding/setupWizard.js';
import { loadConfig, saveConfig, resolveWorkspaceRoot } from '../config.js';
import { initI18n, detectLocale, t } from '../i18n/index.js';

export const metadata = {
  command: '/setup',
  description: t('commands.setup.description') ?? 'Run the setup wizard to configure or reconfigure Autohand',
  implemented: true,
};

/**
 * Run the setup wizard to configure or reconfigure Autohand
 * Supports both interactive mode and JSON-RPC/ACP event emission
 */
export async function setup(ctx: SlashCommandContext): Promise<string | null> {
  // Guard: setup requires interactive terminal for user input
  if (ctx.isNonInteractive) {
    return t('commands.setup.interactiveOnly') ?? 'Setup requires an interactive terminal. Use the --setup CLI flag instead.';
  }

  // Initialize i18n with detected locale
  const { locale: detectedLocale } = detectLocale();
  const locale = detectedLocale ?? 'en';
  await initI18n(locale);

  // Load current config
  const config = await loadConfig(ctx.config?.configPath, ctx.workspaceRoot);
  const workspaceRoot = resolveWorkspaceRoot(config, ctx.workspaceRoot);

  // Emit setup started event if event emitter is available (for ACP/RPC modes)
  if (ctx.eventEmitter) {
    ctx.eventEmitter.emit('setup:started', {
      timestamp: new Date().toISOString(),
      locale,
      workspaceRoot,
    });
  }

  // Create and run the setup wizard with force: true to allow reconfiguration
  const wizard = new SetupWizard(workspaceRoot, config);
  const result = await wizard.run({ force: true, skipWelcome: false });

  // Handle cancelled setup
  if (result.cancelled) {
    if (ctx.eventEmitter) {
      ctx.eventEmitter.emit('setup:cancelled', {
        timestamp: new Date().toISOString(),
        step: 'user_cancelled',
      });
    }
    return t('commands.setup.cancelled') ?? 'Setup cancelled.';
  }

  // Handle failed setup
  if (!result.success) {
    if (ctx.eventEmitter) {
      ctx.eventEmitter.emit('setup:error', {
        timestamp: new Date().toISOString(),
        error: 'setup_failed',
      });
    }
    return t('commands.setup.failed') ?? 'Setup failed. Please try again.';
  }

  // Save the new configuration
  const newConfig = { ...config, ...result.config };
  await saveConfig(newConfig);

  // Emit setup complete event with details (for ACP/RPC modes)
  if (ctx.eventEmitter) {
    // Get model from provider-specific config if available
    const provider = result.config.provider;
    const providerConfig = provider && (result.config as Record<string, unknown>)[provider];
    const model = providerConfig && typeof providerConfig === 'object' && 'model' in providerConfig
      ? (providerConfig as { model?: string }).model
      : undefined;

    ctx.eventEmitter.emit('setup:complete', {
      timestamp: new Date().toISOString(),
      success: true,
      provider,
      model,
      skippedSteps: result.skippedSteps,
      agentsFileCreated: result.agentsFileCreated,
    });
  }

  // Log success message
  console.log(chalk.green(t('commands.setup.complete') ?? '\nSetup complete!'));

  return null;
}
