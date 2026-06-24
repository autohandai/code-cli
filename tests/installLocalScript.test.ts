import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';

const localInstallScriptTest = existsSync('install-local.sh') ? it : it.skip;

describe('local install scripts', () => {
  it('does not run the package build script twice from bun run go', () => {
    const packageJson = JSON.parse(readFileSync('package.json', 'utf8')) as {
      scripts?: Record<string, string>;
    };
    const goScript = packageJson.scripts?.go ?? '';

    expect(goScript).toBe('./install-local.sh && echo "COMPLETED"');
    expect(goScript).not.toContain('bun run build');
    expect(goScript).not.toContain('--skip-compile');
  });

  it('runs proof without nested bun run scripts', () => {
    const packageJson = JSON.parse(readFileSync('package.json', 'utf8')) as {
      scripts?: Record<string, string>;
    };
    const proofScript = packageJson.scripts?.proof ?? '';

    expect(proofScript).toBe('eslint . && tsc --noEmit && node --max-old-space-size=8192 ./node_modules/vitest/vitest.mjs run');
    expect(proofScript).not.toContain('bun run');
  });

  it('runs dev through a minimal bun environment', () => {
    const packageJson = JSON.parse(readFileSync('package.json', 'utf8')) as {
      scripts?: Record<string, string>;
    };
    const devScript = packageJson.scripts?.dev ?? '';

    expect(devScript).toBe('env -i PATH="/Users/igorcosta/.bun/bin:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin" HOME="$HOME" AUTOHAND_DEBUG="$AUTOHAND_DEBUG" bun src/index.ts');
  });

  it('preserves AUTOHAND_DEBUG through the sanitized dev environment', () => {
    const packageJson = JSON.parse(readFileSync('package.json', 'utf8')) as {
      scripts?: Record<string, string>;
    };
    const devScript = packageJson.scripts?.dev ?? '';

    expect(devScript).toContain('env -i ');
    expect(devScript).toContain('AUTOHAND_DEBUG="$AUTOHAND_DEBUG"');
  });

  localInstallScriptTest('compiles the installed binary without running nested package scripts', () => {
    const installScript = readFileSync('install-local.sh', 'utf8');

    expect(installScript).toContain('--skip-compile');
    expect(installScript).toContain('env -i PATH="$HOME/.bun/bin:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin" HOME="$HOME" bun build ./src/index.ts --compile');
    expect(installScript).toContain('INSTALL_PATH="$HOME/.local/bin/autohand"');
    expect(installScript).not.toContain('node ./node_modules/tsup/dist/cli-default.js');
    expect(installScript).not.toContain('bun run build');
    expect(installScript).not.toContain('bun run "compile:');
  });
});

describe('dependency install guardrails', () => {
  it('pins tuistory because its patch releases can introduce broken transitive ranges', () => {
    const packageJson = JSON.parse(readFileSync('package.json', 'utf8')) as {
      devDependencies?: Record<string, string>;
    };

    expect(packageJson.devDependencies?.tuistory).toBe('0.4.0');
  });

  it('uses the committed Bun lockfile in GitHub workflows', () => {
    for (const workflow of ['.github/workflows/ci.yml', '.github/workflows/release.yml']) {
      const content = readFileSync(workflow, 'utf8');

      expect(content).not.toMatch(/\bbun install(?!\s+--frozen-lockfile)/);
    }
  });

  it('uses the dedicated single-thread Vitest mode in release CI', () => {
    const packageJson = JSON.parse(readFileSync('package.json', 'utf8')) as {
      scripts?: Record<string, string>;
    };
    const releaseWorkflow = readFileSync('.github/workflows/release.yml', 'utf8');

    expect(packageJson.scripts?.['test:ci']).toBe("node --max-old-space-size=8192 ./node_modules/vitest/vitest.mjs run --pool=threads --exclude 'tests/tuistory/**/*.tuistory.test.ts'");
    expect(releaseWorkflow).toContain('run: bun run test:ci');
  });

  it('bases alpha releases on the latest stable release tag before package.json fallback', () => {
    const releaseWorkflow = readFileSync('.github/workflows/release.yml', 'utf8');

    expect(releaseWorkflow).toContain('LATEST_STABLE_TAG=$(git tag --list');
    expect(releaseWorkflow).toContain("grep -Ev -- '-(alpha|beta|rc|pre)'");
    expect(releaseWorkflow).toContain('ALPHA_BASE_VERSION="${LATEST_STABLE_TAG#v}"');
    expect(releaseWorkflow).toContain('ALPHA_BASE_VERSION="${CURRENT_VERSION}"');
    expect(releaseWorkflow).toContain('MAJOR=$(echo $ALPHA_BASE_VERSION');
    expect(releaseWorkflow).not.toContain('Alpha: bump patch from current version');
  });
});
