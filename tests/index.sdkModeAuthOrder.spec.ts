/**
 * @license
 * Copyright 2025 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';

describe('index SDK mode startup ordering', () => {
  it('refreshes the model catalog in background startup instead of before the banner', () => {
    const source = readFileSync(path.resolve(process.cwd(), 'src/index.ts'), 'utf8');
    const runCliStart = source.indexOf('async function runCLI(');
    const backgroundStartup = source.indexOf('runtimeResourceOwner.startBackgroundStartup(', runCliStart);
    const catalogRefresh = source.indexOf('refreshModelCatalogOnStartup(', runCliStart);
    const bannerIndex = source.indexOf('printBanner();', runCliStart);

    expect(source).not.toContain('refreshModelCatalogBeforeAgentStart');
    expect(source.indexOf('refreshModelCatalogOnStartup(')).toBe(catalogRefresh);
    expect(bannerIndex).toBeGreaterThan(runCliStart);
    expect(backgroundStartup).toBeGreaterThan(bannerIndex);
    expect(catalogRefresh).toBeGreaterThan(backgroundStartup);
  });

  it('routes RPC and ACP before the interactive auth gate can print or prompt', () => {
    const source = readFileSync(path.resolve(process.cwd(), 'src/index.ts'), 'utf8');
    const actionStart = source.indexOf('.action(async (positionalPrompt:');
    const actionEnd = source.indexOf('registerReviewCommand(program,', actionStart);
    expect(actionStart).toBeGreaterThan(-1);
    expect(actionEnd).toBeGreaterThan(actionStart);
    const startupAction = source.slice(actionStart, actionEnd);
    const authenticationWrapper = source.match(/function authenticateForStartup\([\s\S]*?\n\}/)?.[0];
    expect(authenticationWrapper).toContain('return ensureAuthenticated(config, {');

    const authGateIndex = startupAction.indexOf('await authenticateForStartup(authConfig');
    const routerIndex = startupAction.indexOf('const protocolLaunchMode = resolveProtocolLaunchMode(opts)');
    const rpcModeIndex = startupAction.indexOf("if (protocolLaunchMode === 'rpc')");
    const acpModeIndex = startupAction.indexOf("if (protocolLaunchMode === 'acp')");

    expect(authGateIndex).toBeGreaterThan(-1);
    expect(routerIndex).toBeGreaterThan(-1);
    expect(rpcModeIndex).toBeGreaterThan(-1);
    expect(acpModeIndex).toBeGreaterThan(-1);
    expect(routerIndex).toBeLessThan(rpcModeIndex);
    expect(routerIndex).toBeLessThan(acpModeIndex);
    expect(rpcModeIndex).toBeLessThan(authGateIndex);
    expect(acpModeIndex).toBeLessThan(authGateIndex);
  });
});
