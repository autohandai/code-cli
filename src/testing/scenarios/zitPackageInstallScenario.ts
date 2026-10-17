import { execFileSync } from 'node:child_process';
import { mkdir, readFile, symlink, writeFile } from 'node:fs/promises';
import path from 'node:path';

export async function prepareZitPackageInstallScenario(
  repositoryRoot: string,
  scenarioRoot: string,
  manager: 'npm' | 'bun',
): Promise<{ entryPath: string; packageRoot: string }> {
  const packing = path.join(scenarioRoot, 'packing');
  const consumer = path.join(scenarioRoot, 'consumer');
  const environment = { ...process.env, npm_config_cache: path.join(scenarioRoot, 'npm-cache') };
  await mkdir(packing, { recursive: true });
  await mkdir(consumer, { recursive: true });
  const packed = JSON.parse(execFileSync('npm', [
    'pack', '--ignore-scripts', '--json', '--pack-destination', packing,
  ], { cwd: repositoryRoot, env: environment, encoding: 'utf8', timeout: 60_000, maxBuffer: 4 * 1024 * 1024 })) as Array<{ filename: string }>;
  execFileSync('tar', ['-xzf', path.join(packing, packed[0]!.filename), '-C', packing], { timeout: 30_000 });
  const manifestPath = path.join(packing, 'package', 'package.json');
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8')) as Record<string, unknown>;
  for (const key of ['dependencies', 'devDependencies', 'optionalDependencies', 'peerDependencies']) delete manifest[key];
  await writeFile(manifestPath, JSON.stringify(manifest));
  const archive = path.join(scenarioRoot, 'offline-install.tgz');
  execFileSync('tar', ['-czf', archive, '-C', packing, 'package'], { timeout: 60_000 });
  await writeFile(path.join(consumer, 'package.json'), JSON.stringify({ name: 'zit-install-scenario', private: true, trustedDependencies: [] }));
  const args = manager === 'npm'
    ? ['install', archive, '--offline', '--ignore-scripts', '--no-audit', '--no-fund', '--package-lock=false']
    : ['install', archive, '--no-save', '--cache-dir', path.join(scenarioRoot, 'bun-cache')];
  execFileSync(manager, args, { cwd: consumer, env: environment, encoding: 'utf8', timeout: 60_000 });
  const packageRoot = path.join(consumer, 'node_modules', 'autohand-cli');
  await symlink(path.join(repositoryRoot, 'node_modules'), path.join(packageRoot, 'node_modules'), 'junction');
  return { entryPath: path.join(consumer, 'node_modules', '.bin', 'autohand'), packageRoot };
}
