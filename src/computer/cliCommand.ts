/**
 * @license
 * Copyright 2026 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import chalk from 'chalk';
import { Option, type Command } from 'commander';
import {
  CUA_DRIVER_VERSION,
  inspectCuaDriver,
  resolveCuaDriverPath,
  type CuaDriverInspection,
} from './cuaDriver.js';
import { defaultCuaBinDirectory, installCuaDriver } from './cuaInstaller.js';
import { killAfter } from '../utils/processTimeout.js';
import {
  AUTOHAND_COMPUTER_USE_APP_NAME,
  inspectAutohandComputerUsePermissions,
  resolveAutohandComputerUseHostPath,
} from './autohandComputerUse.js';

interface ComputerStatusOptions {
  json?: boolean;
}

interface ComputerInstallOptions extends ComputerStatusOptions {
  binDir?: string;
  force?: boolean;
  nonInteractive?: boolean;
  postinstall?: boolean;
}

interface ComputerDoctorOptions {
  json?: boolean;
}

interface ComputerStatusReport {
  installed: boolean;
  requiredVersion: string;
  mcpReady: boolean;
  path?: string;
  version?: string;
  supported?: boolean;
  status: 'missing' | CuaDriverInspection['status'];
  error?: string;
}

interface ComputerStatusReportOptions {
  requireComputerUseHost?: boolean;
  computerUseHostReady?: boolean;
}

export function buildComputerStatusReport(
  inspection: CuaDriverInspection | null,
  options: ComputerStatusReportOptions = {},
): ComputerStatusReport {
  if (!inspection) {
    return {
      installed: false,
      requiredVersion: CUA_DRIVER_VERSION,
      mcpReady: false,
      status: 'missing',
    };
  }
  if (inspection.status === 'broken') {
    return {
      installed: true,
      requiredVersion: CUA_DRIVER_VERSION,
      mcpReady: false,
      path: inspection.path,
      status: inspection.status,
      error: inspection.error,
    };
  }
  const computerUseHostReady = options.requireComputerUseHost !== true
    || options.computerUseHostReady === true;
  return {
    installed: true,
    requiredVersion: CUA_DRIVER_VERSION,
    mcpReady: inspection.supported && computerUseHostReady,
    path: inspection.path,
    version: inspection.version,
    supported: inspection.supported,
    status: inspection.status,
    error: inspection.supported && !computerUseHostReady
      ? `${AUTOHAND_COMPUTER_USE_APP_NAME}.app is missing.`
      : undefined,
  };
}

async function readComputerStatus(): Promise<ComputerStatusReport> {
  const driverPath = resolveCuaDriverPath();
  const requireComputerUseHost = process.platform === 'darwin';
  return buildComputerStatusReport(driverPath ? await inspectCuaDriver(driverPath) : null, {
    requireComputerUseHost,
    computerUseHostReady: !requireComputerUseHost
      || resolveAutohandComputerUseHostPath() !== null,
  });
}

function printComputerStatus(report: ComputerStatusReport, json = false): void {
  if (json) {
    console.log(JSON.stringify(report, null, 2));
    return;
  }
  console.log(chalk.bold.cyan('Autohand computer control'));
  if (report.status === 'missing') {
    console.log(chalk.yellow(`  ${AUTOHAND_COMPUTER_USE_APP_NAME} is not installed.`));
    console.log(chalk.gray('  Install it with: autohand computer install'));
    return;
  }
  if (report.status === 'broken') {
    console.log(chalk.red(`  ${AUTOHAND_COMPUTER_USE_APP_NAME} could not start: ${report.error}`));
    console.log(chalk.gray('  Repair it with: autohand computer install --force'));
    return;
  }
  if (report.supported && !report.mcpReady) {
    console.log(chalk.yellow(`  ${report.error}`));
    console.log(chalk.gray('  Repair it with: autohand computer install --force'));
    return;
  }
  console.log(report.supported
    ? chalk.green(`  Ready · ${AUTOHAND_COMPUTER_USE_APP_NAME} · driver ${report.version}`)
    : chalk.yellow(`  ${AUTOHAND_COMPUTER_USE_APP_NAME} driver ${report.version} is older than required ${report.requiredVersion}.`));
  console.log(chalk.gray(`  ${report.path}`));
  console.log(chalk.gray('  Native app tools connect automatically through MCP when Autohand starts.'));
}

async function runDriverDoctor(driverPath: string): Promise<number> {
  return new Promise<number>((resolve, reject) => {
    const child = spawn(driverPath, ['doctor'], {
      env: {
        ...process.env,
        CUA_DRIVER_PERMISSION_MODE: 'standard',
        CUA_DRIVER_RS_TELEMETRY_ENABLED: '0',
      },
      stdio: 'inherit',
      windowsHide: true,
    });
    let timedOut = false;
    killAfter(child, 120_000, () => {
      timedOut = true;
      child.kill('SIGKILL');
    });
    child.once('error', reject);
    child.once('close', (code) => {
      if (timedOut) reject(new Error(`${AUTOHAND_COMPUTER_USE_APP_NAME} doctor timed out.`));
      else resolve(code ?? 1);
    });
  });
}

function isDevelopmentPostinstall(options: ComputerInstallOptions): boolean {
  return options.postinstall === true
    && existsSync(path.join(process.cwd(), '.git'))
    && process.env.AUTOHAND_INSTALL_COMPUTER_USE !== '1'
    && process.env.AUTOHAND_INSTALL_CUA_DRIVER !== '1';
}

async function handleStatus(options: ComputerStatusOptions): Promise<void> {
  const report = await readComputerStatus();
  printComputerStatus(report, options.json);
  if (!report.mcpReady) process.exitCode = 1;
}

async function handleInstall(options: ComputerInstallOptions): Promise<void> {
  if (isDevelopmentPostinstall(options)) {
    if (!options.json) {
      console.log(chalk.gray(`Skipping ${AUTOHAND_COMPUTER_USE_APP_NAME} postinstall in a source checkout. Set AUTOHAND_INSTALL_COMPUTER_USE=1 to install it.`));
    }
    return;
  }
  const binDirectory = path.resolve(options.binDir ?? defaultCuaBinDirectory());
  let result;
  try {
    result = await installCuaDriver({
      binDirectory,
      force: options.force,
    });
  } catch (error) {
    if (!options.postinstall) throw error;
    console.error(chalk.yellow(
      `Could not install native computer control: ${error instanceof Error ? error.message : String(error)}`,
    ));
    console.error(chalk.gray('Retry later with: autohand computer install'));
    return;
  }
  const report = buildComputerStatusReport({
    status: 'ready',
    path: result.path,
    version: result.version,
    supported: true,
  });
  if (options.json) {
    console.log(JSON.stringify({ ...report, installStatus: result.status }, null, 2));
    return;
  }
  console.log(result.status === 'reused'
    ? chalk.green(`${AUTOHAND_COMPUTER_USE_APP_NAME} is already ready (driver ${result.version}).`)
    : chalk.green(`Installed ${AUTOHAND_COMPUTER_USE_APP_NAME} (driver ${result.version}).`));
  console.log(chalk.gray(`  ${result.path}`));
  if (result.computerUse?.permissions === 'granted') {
    console.log(chalk.green('Desktop permissions are granted.'));
  } else if (result.computerUse?.permissions === 'requested') {
    console.log(chalk.gray(`macOS permission requests were opened for ${AUTOHAND_COMPUTER_USE_APP_NAME}.`));
  }
  console.log(chalk.gray('Run `autohand computer doctor` to verify desktop permissions.'));
}

async function handleDoctor(options: ComputerDoctorOptions): Promise<void> {
  const driverPath = resolveCuaDriverPath();
  if (!driverPath) {
    if (options.json) {
      console.log(JSON.stringify(buildComputerStatusReport(null), null, 2));
    } else {
      console.error(chalk.red(`${AUTOHAND_COMPUTER_USE_APP_NAME} is not installed. Run \`autohand computer install\`.`));
    }
    process.exitCode = 1;
    return;
  }
  const computerUseHostPath = resolveAutohandComputerUseHostPath();
  if (process.platform === 'darwin' && computerUseHostPath) {
    const report = buildComputerStatusReport(await inspectCuaDriver(driverPath));
    const appPath = path.resolve(computerUseHostPath, '..', '..', '..');
    const permissions = await inspectAutohandComputerUsePermissions(appPath);
    const ready = report.mcpReady && permissions.accessibility && permissions.screenRecording;
    if (options.json) {
      console.log(JSON.stringify({
        ...report,
        permissionOwner: AUTOHAND_COMPUTER_USE_APP_NAME,
        permissions,
      }, null, 2));
    } else {
      console.log(chalk.bold.cyan(AUTOHAND_COMPUTER_USE_APP_NAME));
      console.log(permissions.accessibility
        ? chalk.green('  Accessibility · granted')
        : chalk.yellow('  Accessibility · permission required'));
      console.log(permissions.screenRecording
        ? chalk.green('  Screen Recording · granted')
        : chalk.yellow('  Screen Recording · permission required'));
      console.log(report.mcpReady
        ? chalk.green(`  Driver ${report.version} · ready`)
        : chalk.red(`  Driver · ${report.error ?? 'not ready'}`));
    }
    if (!ready) process.exitCode = 1;
    return;
  }
  if (options.json) {
    const report = buildComputerStatusReport(await inspectCuaDriver(driverPath));
    console.log(JSON.stringify(report, null, 2));
    if (!report.mcpReady) process.exitCode = 1;
    return;
  }
  process.exitCode = await runDriverDoctor(driverPath);
}

/** Register installation, health, and permission diagnostics for native GUI control. */
export function registerComputerCommand(program: Command): void {
  const withRootJson = <T extends ComputerStatusOptions>(options: T): T => ({
    ...options,
    json: options.json === true
      || program.opts<{ json?: boolean | string }>().json !== undefined,
  });

  const computer = program
    .command('computer')
    .description(`Install and diagnose ${AUTOHAND_COMPUTER_USE_APP_NAME}`)
    .option('--json', 'Print machine-readable status', false)
    .action((options: ComputerStatusOptions) => handleStatus(withRootJson(options)));

  computer
    .command('status')
    .description(`Show ${AUTOHAND_COMPUTER_USE_APP_NAME} readiness`)
    .option('--json', 'Print machine-readable status', false)
    .action((options: ComputerStatusOptions) => handleStatus(withRootJson(options)));

  computer
    .command('install')
    .description(`Install or repair ${AUTOHAND_COMPUTER_USE_APP_NAME}`)
    .option('--bin-dir <path>', 'Directory for the computer-use engine executable')
    .option('--force', 'Reinstall even when a supported driver already exists', false)
    .option('--non-interactive', 'Run without Autohand confirmation prompts', false)
    .option('--json', 'Print machine-readable result', false)
    .addOption(new Option('--postinstall').hideHelp())
    .action((options: ComputerInstallOptions) => handleInstall(withRootJson(options)));

  computer
    .command('doctor')
    .description(`Run ${AUTOHAND_COMPUTER_USE_APP_NAME} diagnostics`)
    .option('--json', 'Check installation readiness without interactive permission prompts', false)
    .action((options: ComputerDoctorOptions) => handleDoctor(withRootJson(options)));
}
