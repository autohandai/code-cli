/** @license Apache-2.0 */
import { createHash } from 'node:crypto';
import path from 'node:path';

export interface AhTracesRuntimePaths {
  directory: string;
  stateFile: string;
  daemonLock: string;
  supervisorLock: string;
  checkpointsFile: string;
  workMapFile: string;
  socketPath: string;
}

export interface AhTracesRuntimePathOptions {
  autohandHome: string;
  platform?: NodeJS.Platform;
  temporaryDirectory: string;
  userId?: number;
}

export function resolveAhTracesRuntimePaths(
  options: AhTracesRuntimePathOptions,
): AhTracesRuntimePaths {
  const platform = options.platform ?? process.platform;
  const pathApi = platform === 'win32' ? path.win32 : path;
  const directory = pathApi.join(options.autohandHome, 'traces');
  const normalizedHome = pathApi.normalize(options.autohandHome);
  const homeHash = createHash('sha256')
    .update(platform === 'win32' ? normalizedHome.toLowerCase() : normalizedHome)
    .digest('hex')
    .slice(0, 16);
  const socketPath = platform === 'win32'
    ? `\\\\.\\pipe\\ahtraces-${homeHash}`
    : path.join(
        options.temporaryDirectory,
        `ahtraces-${options.userId ?? process.getuid?.() ?? 'user'}-${homeHash}.sock`,
      );

  return {
    directory,
    stateFile: pathApi.join(directory, 'daemon.json'),
    daemonLock: pathApi.join(directory, 'daemon.lock'),
    supervisorLock: pathApi.join(directory, 'supervisor.lock'),
    checkpointsFile: pathApi.join(directory, 'checkpoints.json'),
    workMapFile: pathApi.join(directory, 'work-map.json'),
    socketPath,
  };
}
