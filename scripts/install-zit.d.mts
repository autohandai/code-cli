/** @license Apache-2.0 */

export interface ZitInstallOptions {
  packageRoot?: string;
  platform?: string;
  architecture?: string;
  environment?: NodeJS.ProcessEnv;
  fetchImpl?: typeof fetch;
  releaseBaseUrl?: string;
  force?: boolean;
}

export type ZitInstallResult =
  | { status: 'skipped' | 'skipped-development' | 'unsupported' }
  | { status: 'installed' | 'existing'; path: string };

export function resolveZitArtifact(platform?: string, architecture?: string): {
  name: string;
  directory: string;
} | null;

export function installZit(options?: ZitInstallOptions): Promise<ZitInstallResult>;
export function bundleZit(options?: ZitInstallOptions): Promise<ZitInstallResult[]>;
