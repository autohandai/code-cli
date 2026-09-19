/** @license Apache-2.0 */
import { existsSync } from 'node:fs';
import os from 'node:os';
import type { LoadedConfig } from '../../types.js';
import { AUTOHAND_HOME } from '../../constants.js';
import { resolveAhTracesRuntimePaths } from '../runtimePaths.js';
import {
  AHTRACES_PROTOCOL_VERSION,
  getAhTracesVersion,
} from '../version.js';
import {
  AhTracesSupervisor,
  type AhTracesSupervisorResult,
} from './AhTracesSupervisor.js';
import { NodeAhTracesSupervisorHost } from './NodeAhTracesSupervisorHost.js';

export type AhTracesRuntimeResult = AhTracesSupervisorResult | {
  status: 'error';
  code: 'unavailable';
};

export interface ReconcileAhTracesOptions {
  strict?: boolean;
  supervisor?: Pick<AhTracesSupervisor, 'reconcile'>;
  hasRuntimeArtifacts?: () => boolean;
}

let shared: {
  key: string;
  supervisor: AhTracesSupervisor;
} | null = null;

export function shouldReconcileAhTracesAtStartup(
  bare: boolean,
  environment: NodeJS.ProcessEnv = process.env,
): boolean {
  return !bare && environment.AUTOHAND_CODE_SIMPLE !== '1';
}

function runtimeSupervisor(config: LoadedConfig): AhTracesSupervisor {
  const paths = runtimePaths();
  const key = `${paths.stateFile}\0${config.configPath}`;
  if (shared?.key === key) return shared.supervisor;
  const host = new NodeAhTracesSupervisorHost({
    paths,
    configPath: config.configPath,
  });
  const supervisor = new AhTracesSupervisor(host, {
    version: getAhTracesVersion(),
    protocolVersion: AHTRACES_PROTOCOL_VERSION,
    configPath: config.configPath,
  });
  shared = { key, supervisor };
  return supervisor;
}

function runtimePaths() {
  return resolveAhTracesRuntimePaths({
    autohandHome: AUTOHAND_HOME,
    temporaryDirectory: os.tmpdir(),
  });
}

function hasRuntimeArtifacts(): boolean {
  const paths = runtimePaths();
  return [
    paths.stateFile,
    paths.daemonLock,
    paths.checkpointsFile,
    paths.workMapFile,
    paths.socketPath,
  ].some((candidate) => existsSync(candidate));
}

export async function reconcileAhTraces(
  config: LoadedConfig,
  options: ReconcileAhTracesOptions = {},
): Promise<AhTracesRuntimeResult> {
  try {
    const enabled = config.traces?.enabled === true;
    if (!enabled && !(options.hasRuntimeArtifacts ?? hasRuntimeArtifacts)()) {
      return { status: 'disabled' };
    }
    const supervisor = options.supervisor ?? runtimeSupervisor(config);
    return await supervisor.reconcile({ enabled });
  } catch (error) {
    if (options.strict) throw error;
    return { status: 'error', code: 'unavailable' };
  }
}
