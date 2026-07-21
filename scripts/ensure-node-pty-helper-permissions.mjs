import { constants } from 'node:fs';
import { access, chmod, stat } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';

function resolveNodePtyRoot() {
  try {
    const require = createRequire(import.meta.url);
    return dirname(require.resolve('node-pty/package.json'));
  } catch {
    return null;
  }
}

const nodePtyRoot = process.argv[2] ?? resolveNodePtyRoot();
const platform = process.argv[3] ?? process.platform;
const architecture = process.argv[4] ?? process.arch;

if (platform !== 'win32' && nodePtyRoot !== null) {
  const nativeDirectories = [
    join('build', 'Release'),
    join('build', 'Debug'),
    join('prebuilds', `${platform}-${architecture}`),
  ];
  for (const nativeDirectory of nativeDirectories) {
    const directory = join(nodePtyRoot, nativeDirectory);
    const nativeModulePath = join(directory, 'pty.node');
    const helperPath = join(directory, 'spawn-helper');

    try {
      const [nativeModule, helper] = await Promise.all([
        stat(nativeModulePath),
        stat(helperPath),
      ]);

      if (!nativeModule.isFile() || !helper.isFile()) {
        continue;
      }

      try {
        await access(helperPath, constants.X_OK);
      } catch {
        await chmod(helperPath, (helper.mode & 0o7777) | 0o111);
      }
    } catch (error) {
      if (error instanceof Error && 'code' in error && error.code === 'ENOENT') {
        continue;
      }

      break;
    }
  }
}
