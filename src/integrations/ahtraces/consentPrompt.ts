/** @license Apache-2.0 */
import chalk from 'chalk';
import { saveConfig } from '../../config.js';
import type { LoadedConfig } from '../../types.js';
import { showModal, type ModalOption } from '../../ui/ink/components/Modal.js';
import {
  applyTraceConsentChoice,
  needsTraceConsent,
  type TraceConsentChoice,
} from './consent.js';
import { reconcileAhTraces } from './client.js';

const TRACE_CONSENT_OPTIONS: readonly ModalOption[] = [
  {
    label: 'Disabled (recommended default)',
    value: 'disabled',
    description: 'Do not monitor coding-agent session files and do not run ahtraces.',
  },
  {
    label: 'Local Work Map only',
    value: 'local',
    description: 'Process sessions locally and retain aggregate usage, outcome, and workflow signals.',
  },
  {
    label: 'Cloud sync — metadata only',
    value: 'cloud-metadata',
    description: 'Upload pseudonymous timing, agent, model, provider, reasoning, token, relationship, and outcome metadata.',
  },
  {
    label: 'Cloud sync — redacted full traces',
    value: 'cloud-full',
    description: 'Also upload bounded, redacted message and tool parts; this can include prompts, responses, and reasoning.',
  },
];

function isTraceConsentChoice(value: unknown): value is TraceConsentChoice {
  return TRACE_CONSENT_OPTIONS.some((option) => option.value === value);
}

function configuredChoice(config: LoadedConfig): TraceConsentChoice {
  if (config.traces?.enabled !== true) return 'disabled';
  if (config.traces.cloudSync !== true) return 'local';
  return config.traces.contentMode === 'full' ? 'cloud-full' : 'cloud-metadata';
}

export function printTraceConsentNotice(): void {
  console.log();
  console.log(chalk.white.bold('  Agent traces and Work Map'));
  console.log(chalk.gray('  Autohand can monitor supported coding-agent session files after the CLI exits.'));
  console.log(chalk.gray('  Local mode stores a pseudonymous aggregate index, never raw prompts or code.'));
  console.log(chalk.gray('  Cloud modes add cross-agent visibility at https://console.autohand.ai/traces.'));
  console.log(chalk.gray('  Trace ingestion and storage does not count against your Autohand API usage.'));
  console.log(chalk.gray('  Cloud modes require authentication and a separate explicit choice below.'));
  console.log(chalk.gray('  Stop anytime with autohand --traces-off or ahtraces off.'));
  console.log(chalk.gray('  You can delete cloud trace data anytime from https://console.autohand.ai/account.'));
  console.log();
}

export async function promptTraceConsentChoice(
  initialChoice: TraceConsentChoice = 'disabled',
): Promise<TraceConsentChoice | undefined> {
  printTraceConsentNotice();
  const initialIndex = Math.max(
    0,
    TRACE_CONSENT_OPTIONS.findIndex((option) => option.value === initialChoice),
  );
  const result = await showModal({
    title: 'Choose trace monitoring and cloud sharing',
    initialIndex,
    options: [...TRACE_CONSENT_OPTIONS],
  });
  return isTraceConsentChoice(result?.value) ? result.value : undefined;
}

export async function ensureExistingUserTraceConsent(
  config: LoadedConfig,
): Promise<LoadedConfig> {
  if (!needsTraceConsent(config)) return config;
  const choice = await promptTraceConsentChoice(configuredChoice(config));
  if (!choice) return config;
  const updated = applyTraceConsentChoice(config, choice);
  await saveConfig(updated);
  await reconcileAhTraces(updated, { strict: true });
  return updated;
}
