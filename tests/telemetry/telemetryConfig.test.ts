import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('telemetry API configuration', () => {
  it('passes an API company secret into TelemetryManager', () => {
    const source = readFileSync('src/core/agent/AgentDependencyComposer.ts', 'utf8');

    expect(source).toContain("companySecret: runtime.config.telemetry?.companySecret || runtime.config.api?.companySecret || ''");
  });

  it('syncs sessions by default unless the user explicitly disables it', () => {
    const source = readFileSync('src/core/agent/AgentDependencyComposer.ts', 'utf8');

    expect(source).toContain('enableSessionSync: runtime.config.telemetry?.enableSessionSync !== false');
  });
});
