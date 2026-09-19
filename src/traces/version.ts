/** @license Apache-2.0 */
import { execFileSync } from 'node:child_process';
import packageJson from '../../package.json' with { type: 'json' };

export const AHTRACES_PROTOCOL_VERSION = 1;

function sourceRevision(): string {
  const embedded = process.env.BUILD_GIT_COMMIT;
  if (embedded && embedded !== 'undefined') return embedded;
  const alpha = /-alpha\.([0-9a-f]{7,40})$/iu.exec(packageJson.version)?.[1];
  if (alpha) return alpha;
  if (process.env.AUTOHAND_VERSION_SOURCE !== 'git') return 'release';
  try {
    return execFileSync('git', ['rev-parse', '--short', 'HEAD'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
      timeout: 500,
      killSignal: 'SIGKILL',
    }).trim() || 'unknown';
  } catch {
    return 'unknown';
  }
}

export function getAhTracesVersion(): string {
  return `${packageJson.version}:${sourceRevision()}`;
}

export function getAhTracesDisplayVersion(): string {
  return packageJson.version;
}
