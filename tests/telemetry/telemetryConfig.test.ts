import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('telemetry API configuration', () => {
  it('passes an API company secret into TelemetryManager', () => {
    const source = readFileSync('src/core/agent/AgentDependencyComposer.ts', 'utf8');

    expect(source).toContain("companySecret: runtime.config.telemetry?.companySecret || runtime.config.api?.companySecret || ''");
  });

  it('syncs session content only after both telemetry and session sync are explicitly enabled', () => {
    const source = readFileSync('src/core/agent/AgentDependencyComposer.ts', 'utf8');

    expect(source).toContain(
      'enableSessionSync: runtime.config.telemetry?.enabled === true && runtime.config.telemetry?.enableSessionSync === true',
    );
  });
});
