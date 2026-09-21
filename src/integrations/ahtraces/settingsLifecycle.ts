/** @license Apache-2.0 */
import type { SettingsChange } from '../../commands/settings.js';
import type { LoadedConfig } from '../../types.js';
import { reconcileAhTraces } from './client.js';

export async function applyTraceSettingChange(
  config: LoadedConfig,
  change: Pick<SettingsChange, 'key'>,
): Promise<void> {
  if (!change.key.startsWith('traces.')) return;
  await reconcileAhTraces(config, { strict: true });
}
