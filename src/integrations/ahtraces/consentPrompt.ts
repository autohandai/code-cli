/** @license Apache-2.0 */
import chalk from 'chalk';
import { t } from '../../i18n/index.js';
import { saveConfig } from '../../config.js';
import type { LoadedConfig } from '../../types.js';
import { showModal, type ModalOption } from '../../ui/ink/components/Modal.js';
import {
  applyTraceConsentChoice,
  needsTraceConsent,
  type TraceConsentChoice,
} from './consent.js';
import { reconcileAhTraces } from './client.js';

// Built on demand so labels follow the display language chosen at runtime.
const traceConsentOptions = (): ModalOption[] => [
  {
    label: t('traces.consent.disabled'),
    value: 'disabled',
    description: t('traces.consent.disabledDescription'),
  },
  {
    label: t('traces.consent.local'),
    value: 'local',
    description: t('traces.consent.localDescription'),
  },
  {
    label: t('traces.consent.cloudMetadata'),
    value: 'cloud-metadata',
    description: t('traces.consent.cloudMetadataDescription'),
  },
  {
    label: t('traces.consent.cloudFull'),
    value: 'cloud-full',
    description: t('traces.consent.cloudFullDescription'),
  },
];

function isTraceConsentChoice(value: unknown): value is TraceConsentChoice {
  return traceConsentOptions().some((option) => option.value === value);
}

function configuredChoice(config: LoadedConfig): TraceConsentChoice {
  if (config.traces?.enabled !== true) return 'disabled';
  if (config.traces.cloudSync !== true) return 'local';
  return config.traces.contentMode === 'full' ? 'cloud-full' : 'cloud-metadata';
}

export function printTraceConsentNotice(): void {
  console.log();
  console.log(chalk.white.bold(`  ${t('traces.consent.title')}`));
  console.log(chalk.gray(`  ${t('traces.consent.line1')}`));
  console.log(chalk.gray(`  ${t('traces.consent.line2')}`));
  console.log(chalk.gray(`  ${t('traces.consent.line3')}`));
  console.log(chalk.gray(`  ${t('traces.consent.line4')}`));
  console.log(chalk.gray(`  ${t('traces.consent.line5')}`));
  console.log(chalk.gray(`  ${t('traces.consent.line6')}`));
  console.log(chalk.gray(`  ${t('traces.consent.line7')}`));
  console.log();
}

export async function promptTraceConsentChoice(
  initialChoice: TraceConsentChoice = 'disabled',
): Promise<TraceConsentChoice | undefined> {
  printTraceConsentNotice();
  const initialIndex = Math.max(
    0,
    traceConsentOptions().findIndex((option) => option.value === initialChoice),
  );
  const result = await showModal({
    title: t('traces.consent.prompt'),
    initialIndex,
    options: traceConsentOptions(),
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
