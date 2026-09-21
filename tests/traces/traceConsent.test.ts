import { describe, expect, it } from 'vitest';
import type { LoadedConfig } from '../../src/types.js';
import {
  applyTraceConsentChoice,
  needsTraceConsent,
} from '../../src/traces/consent.js';

function config(overrides: Partial<LoadedConfig> = {}): LoadedConfig {
  return {
    configPath: '/tmp/config.json',
    isNewConfig: false,
    ...overrides,
  } as LoadedConfig;
}

describe('trace consent migration', () => {
  it('asks existing users once while leaving new users to full onboarding', () => {
    expect(needsTraceConsent(config())).toBe(true);
    expect(needsTraceConsent(config({ isNewConfig: true }))).toBe(false);
    expect(needsTraceConsent(config({ traces: { consentVersion: 1 } }))).toBe(false);
  });

  it('maps each explicit choice to a versioned, internally consistent setting', () => {
    expect(applyTraceConsentChoice(config(), 'disabled').traces).toEqual({
      consentVersion: 1,
      enabled: false,
      cloudSync: false,
      contentMode: 'metadata',
      discoveryMap: false,
    });
    expect(applyTraceConsentChoice(config(), 'local').traces).toEqual({
      consentVersion: 1,
      enabled: true,
      cloudSync: false,
      contentMode: 'metadata',
      discoveryMap: true,
    });
    expect(applyTraceConsentChoice(config(), 'cloud-full').traces).toEqual({
      consentVersion: 1,
      enabled: true,
      cloudSync: true,
      contentMode: 'full',
      discoveryMap: true,
    });
  });
});
