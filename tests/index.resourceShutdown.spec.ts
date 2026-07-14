import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const indexSource = readFileSync(new URL('../src/index.ts', import.meta.url), 'utf8');
const rpcSource = readFileSync(new URL('../src/modes/rpc/index.ts', import.meta.url), 'utf8');

function functionSlice(source: string, start: string, end: string): string {
  const startIndex = source.indexOf(start);
  const endIndex = source.indexOf(end, startIndex + start.length);
  expect(startIndex).toBeGreaterThanOrEqual(0);
  expect(endIndex).toBeGreaterThan(startIndex);
  return source.slice(startIndex, endIndex);
}

describe('CLI runtime resource boundaries', () => {
  it('returns through awaited cleanup without forcing command, fork, resume, or interactive exits', () => {
    const runCli = functionSlice(indexSource, 'async function runCLI(', '\nfunction printBanner(');
    const agentBoundary = runCli.slice(runCli.indexOf('agent = new AutohandAgent'));

    expect(runCli).not.toContain('process.exit(');
    expect(agentBoundary).not.toContain('process.exit(');
    expect(agentBoundary).toContain('await Promise.allSettled([');
    expect(agentBoundary).toContain('agent?.shutdownRuntimeResources()');
    expect(agentBoundary).toContain('runtimeResourceOwner?.shutdown()');
    expect(agentBoundary).toContain('process.exitCode = succeeded ? 0 : 1');
  });

  it('routes background signals through agent cancellation and owned cleanup', () => {
    const runCli = functionSlice(indexSource, 'async function runCLI(', '\nfunction printBanner(');
    const providerCreation = runCli.indexOf('ProviderFactory.create(config)');
    const agentConstruction = runCli.indexOf('agent = new AutohandAgent');
    const preProviderAbortGuard = runCli.indexOf(
      'if (commandLifecycleController.signal.aborted) {',
    );
    const preAgentAbortGuard = runCli.lastIndexOf(
      'if (commandLifecycleController.signal.aborted) {',
      agentConstruction,
    );

    expect(runCli).toContain('const commandLifecycleController = new AbortController()');
    expect(runCli).toMatch(/awaitCliLifecycleStep\(\s*loadConfig/);
    expect(runCli).toMatch(/awaitCliLifecycleStep\(\s*runStartupChecks/);
    expect(runCli).toMatch(/awaitCliLifecycleStep\(\s*readPipedStdin/);
    expect(runCli).toContain('commandLifecycleController.abort(');
    expect(runCli).toContain('agentHolder.current?.requestExit()');
    expect(runCli).toMatch(/agent\.runCommandMode\(\s*options\.prompt,\s*commandLifecycleController\.signal/);
    expect(runCli.indexOf('new CliRuntimeResourceOwner')).toBeLessThan(
      runCli.indexOf('if (!options.bare)'),
    );
    expect(preProviderAbortGuard).toBeGreaterThan(0);
    expect(preProviderAbortGuard).toBeLessThan(providerCreation);
    expect(preAgentAbortGuard).toBeGreaterThan(providerCreation);
    expect(preAgentAbortGuard).toBeLessThan(agentConstruction);
    expect(runCli.slice(agentConstruction)).toContain(
      'if (commandLifecycleController.signal.aborted) {\n      agent.requestExit();\n      return;\n    }',
    );
    expect(runCli).not.toContain('onSignal: async () =>');
    expect(runCli).not.toContain("process.on('exit'");
    expect(runCli).not.toContain("process.on('SIGINT'");
    expect(runCli).not.toContain("process.on('SIGTERM'");
  });

  it('returns through awaited cleanup without forcing patch or automode exits', () => {
    const patch = functionSlice(indexSource, 'async function runPatchMode(', '/**\n * Handle --auto-mode');
    const automode = functionSlice(indexSource, 'async function runAutoMode(', '/**\n * Build prompt for each auto-mode');
    const patchAgentBoundary = patch.slice(patch.indexOf('let agent: AutohandAgent'));
    const automodeAgentBoundary = automode.slice(automode.indexOf('let agent: AutohandAgent'));

    expect(patchAgentBoundary).not.toContain('process.exit(');
    expect(patchAgentBoundary).toContain('await agent?.shutdownRuntimeResources()');
    expect(automodeAgentBoundary).not.toContain('process.exit(');
    expect(automodeAgentBoundary).toContain('await agent?.shutdownRuntimeResources()');
  });

  it('lets RPC termination unwind through reader disposal, output drain, and cleanup', () => {
    expect(rpcSource).not.toContain('process.exit(');
    expect(rpcSource).toContain("process.on('SIGTERM'");
    expect(rpcSource).toContain('reader?.dispose()');

    const adapterShutdown = rpcSource.indexOf('await adapter?.shutdown');
    const flushOutput = rpcSource.indexOf('await flushRpcOutput()');
    const removeStdoutGuard = rpcSource.indexOf("process.stdout.off('error'");
    expect(adapterShutdown).toBeGreaterThan(0);
    expect(flushOutput).toBeGreaterThan(adapterShutdown);
    expect(removeStdoutGuard).toBeGreaterThan(flushOutput);
  });
});
