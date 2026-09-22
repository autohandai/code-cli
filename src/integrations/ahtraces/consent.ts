/** @license Apache-2.0 */
import type { LoadedConfig } from '../../types.js';

export const TRACE_CONSENT_VERSION = 1;

export type TraceConsentChoice = 'disabled' | 'local' | 'cloud-metadata' | 'cloud-full';

export function hasCurrentTraceConsent(config: LoadedConfig): boolean {
  return config.traces?.consentVersion === TRACE_CONSENT_VERSION;
}

export function isTraceMonitoringEnabled(config: LoadedConfig): boolean {
  return hasCurrentTraceConsent(config) && config.traces?.enabled === true;
}

export function needsTraceConsent(config: LoadedConfig): boolean {
  return config.isNewConfig !== true && !hasCurrentTraceConsent(config);
}

export function applyTraceConsentChoice(
  config: LoadedConfig,
  choice: TraceConsentChoice,
): LoadedConfig {
  const enabled = choice !== 'disabled';
  return {
    ...config,
    traces: {
      ...config.traces,
      consentVersion: TRACE_CONSENT_VERSION,
      enabled,
      cloudSync: choice === 'cloud-metadata' || choice === 'cloud-full',
      contentMode: choice === 'cloud-full' ? 'full' : 'metadata',
      discoveryMap: enabled,
    },
  };
}
