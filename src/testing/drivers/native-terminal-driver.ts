/** @license Apache-2.0 */
import { execFileSync } from 'node:child_process';
import { copyFile, mkdir, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

export async function prepareNativeTerminalTest(): Promise<{ args: string[]; resultBundle: string }> {
  if (process.platform !== 'darwin' || process.env.GITHUB_ACTIONS !== 'true' || process.env.CI !== 'true') {
    throw new Error('Native terminal UI automation runs only on an isolated macOS GitHub Actions runner.');
  }
  const terminal = process.env.AUTOHAND_NATIVE_TERMINAL;
  const applications: Record<string, string> = { iterm2: '/Applications/iTerm.app', ghostty: '/Applications/Ghostty.app',
    cmux: '/Applications/cmux.app', vscode: '/Applications/Visual Studio Code.app' };
  const application = terminal ? applications[terminal] : undefined;
  if (!terminal || !application) {
    throw new Error('Choose iterm2, ghostty, cmux, or vscode for AUTOHAND_NATIVE_TERMINAL.');
  }
  const root = process.cwd();
  const output = path.resolve('.artifacts', 'native-terminal', terminal);
  await mkdir(output, { recursive: true });
  const fixture = path.join(output, 'Autohand Terminal Fixture.command');
  const quote = (value: string) => `'${value.replaceAll("'", "'\\''")}'`;
  const bun = execFileSync('/bin/sh', ['-c', 'command -v bun'], { encoding: 'utf8' }).trim();
  await writeFile(fixture, `#!/bin/sh\nset -eu\ncd ${quote(root)}\nexport AUTOHAND_HOME=${quote(path.join(output, 'home'))}\nexport CI=false\nexec ${quote(bun)} src/testing/scenarios/resizeFlickerScenario.tsx --full-screen --multiline "$@"\n`, { mode: 0o755 });
  const profile = path.join(output, 'vscode-profile');
  await mkdir(path.join(profile, 'User'), { recursive: true });
  await writeFile(path.join(profile, 'User', 'settings.json'), JSON.stringify({
    'editor.accessibilitySupport': 'on', 'workbench.startupEditor': 'none', 'window.restoreWindows': 'none',
    'workbench.panel.opensMaximized': 'always',
    'update.mode': 'none', 'security.workspace.trust.enabled': false,
    'terminal.integrated.enablePersistentSessions': false, 'terminal.integrated.scrollback': 5000,
  }));
  const project = path.resolve('src/testing/drivers/native-terminal-lab');
  for (const source of ['Host.swift', 'TerminalCompatibilityUITests.swift']) {
    await copyFile(path.join(project, source), path.join(output, source));
  }
  execFileSync('xcodegen', ['generate', '--spec', path.join(project, 'project.yml'), '--project', output], { stdio: 'pipe', timeout: 30_000 });
  const derived = path.join(output, 'DerivedData');
  execFileSync('/usr/bin/xcodebuild', ['build-for-testing', '-project', path.join(output, 'TerminalLab.xcodeproj'),
    '-scheme', 'TerminalLab', '-destination', 'platform=macOS', '-derivedDataPath', derived, 'CODE_SIGNING_ALLOWED=NO'],
  { stdio: 'pipe', timeout: 120_000 });
  const products = path.join(derived, 'Build', 'Products');
  const runFile = (await readdir(products)).find(file => file.endsWith('.xctestrun'));
  if (!runFile) throw new Error('Xcode did not produce the native UI test configuration.');
  const testRun = path.join(products, runFile);
  execFileSync('/usr/bin/python3', ['-c',
    'import json,plistlib,sys\np=sys.argv[1]\nd=plistlib.load(open(p,"rb"))\ne=json.loads(sys.argv[2])\ntargets=[t for c in d.get("TestConfigurations",[]) for t in c["TestTargets"]] if "TestConfigurations" in d else [v for k,v in d.items() if k!="__xctestrun_metadata__" and isinstance(v,dict)]\nfor t in targets: t.setdefault("EnvironmentVariables",{}).update(e)\nplistlib.dump(d,open(p,"wb"))',
    testRun, JSON.stringify({ AUTOHAND_NATIVE_TERMINAL: terminal, AUTOHAND_NATIVE_FIXTURE: fixture,
      AUTOHAND_NATIVE_PROFILE: profile, AUTOHAND_NATIVE_APPLICATION: application, GITHUB_ACTIONS: 'true' })], { timeout: 10_000 });
  const resultBundle = path.join(output, 'NativeTerminal.xcresult');
  return { resultBundle, args: ['test-without-building', '-xctestrun', testRun, '-destination', 'platform=macOS',
    '-parallel-testing-enabled', 'NO', '-resultBundlePath', resultBundle] };
}
