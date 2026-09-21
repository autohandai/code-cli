/** @license Apache-2.0 */
import { saveConfig } from '../../config.js';
import type { LoadedConfig } from '../../types.js';
import { reconcileAhTraces } from './client.js';
import { applyTraceConsentChoice } from './consent.js';

export async function setTraceMonitoringEnabled(
  config: LoadedConfig,
  enabled: boolean,
): Promise<LoadedConfig> {
  const updated = applyTraceConsentChoice(config, enabled ? 'cloud-metadata' : 'disabled');
  await saveConfig(updated);
  await reconcileAhTraces(updated, { strict: true });
  return updated;
}
