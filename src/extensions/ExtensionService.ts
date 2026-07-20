/**
 * @license
 * Copyright 2025 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { createHash, randomUUID } from 'node:crypto';
import nodeFs from 'node:fs/promises';
import fs from 'fs-extra';
import path from 'node:path';
import { AUTOHAND_PATHS } from '../constants.js';
import {
  ExtensionRegistry,
  validateExtensionPackage,
  type ExtensionLoadOptions,
  type ValidatedExtensionPackage,
} from './ExtensionRegistry.js';
import { EXTENSION_STATE_FILE, readExtensionPackage } from './manifest.js';
import { EXTENSION_ID_PATTERN } from './schema.js';
import type {
  ExtensionDiagnostic,
  ExtensionScope,
  ExtensionSnapshot,
  LoadedExtension,
} from './types.js';
import { extensionRuntimeHost } from './ExtensionRuntimeHost.js';

export interface ExtensionServiceOptions {
  userRoot?: string;
  projectRoot?: string;
  loadOptions?: ExtensionLoadOptions | (() => ExtensionLoadOptions | Promise<ExtensionLoadOptions>);
}

export interface ExtensionInstallOptions {
  scope?: ExtensionScope;
  replace?: boolean;
  link?: boolean;
  trust?: boolean;
}

export interface ExtensionMutationOptions {
  scope?: ExtensionScope;
}

export interface ExtensionInstallResult {
  status: 'installed' | 'existing' | 'replaced';
  extension: LoadedExtension;
}

export interface ExtensionDoctorReport {
  healthy: boolean;
  extensions: number;
  diagnostics: ExtensionDiagnostic[];
}

function pathForScope(
  options: Required<Pick<ExtensionServiceOptions, 'userRoot'>> & Pick<ExtensionServiceOptions, 'projectRoot'>,
  scope: ExtensionScope,
): string {
  if (scope === 'user') {
    return options.userRoot;
  }
  if (!options.projectRoot) {
    throw new Error('Project extension scope requires a workspace extension root');
  }
  return options.projectRoot;
}

function assertExtensionId(id: string): void {
  if (!EXTENSION_ID_PATTERN.test(id)) {
    throw new Error(`Invalid extension id "${id}"`);
  }
}

function statePath(root: string, id: string): string {
  return path.join(root, '.state', `${id}.json`);
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function acquireExtensionLock(root: string, id: string): Promise<() => Promise<void>> {
  const locksRoot = path.join(root, '.locks');
  const lockPath = path.join(locksRoot, `${id}.lock`);
  await fs.ensureDir(locksRoot);
  for (let attempt = 0; attempt < 80; attempt++) {
    try {
      const handle = await nodeFs.open(lockPath, 'wx', 0o600);
      await handle.close();
      return async () => {
        await fs.remove(lockPath).catch(() => {});
      };
    } catch (error) {
      const code = typeof error === 'object' && error && 'code' in error
        ? (error as { code?: string }).code
        : undefined;
      if (code !== 'EEXIST') {
        throw error;
      }
      await delay(25);
    }
  }
  throw new Error(`Timed out waiting for extension lock "${id}"`);
}

async function writeJsonAtomic(filePath: string, value: unknown): Promise<void> {
  const tempPath = `${filePath}.${process.pid}.${randomUUID()}.tmp`;
  try {
    await fs.ensureDir(path.dirname(filePath));
    await fs.outputFile(tempPath, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
    const handle = await nodeFs.open(tempPath, 'r');
    try {
      await handle.sync();
    } finally {
      await handle.close();
    }
    await nodeFs.rename(tempPath, filePath);
  } catch (error) {
    await fs.remove(tempPath).catch(() => {});
    throw error;
  }
}

async function packageFingerprint(packageRoot: string): Promise<string> {
  const root = await fs.realpath(packageRoot);
  const hash = createHash('sha256');

  async function visit(directory: string): Promise<void> {
    const entries = (await fs.readdir(directory)).sort((left, right) => left.localeCompare(right));
    for (const entry of entries) {
      if (entry === EXTENSION_STATE_FILE) {
        continue;
      }
      const absolutePath = path.join(directory, entry);
      const relativePath = path.relative(root, absolutePath).split(path.sep).join('/');
      const stat = await fs.lstat(absolutePath);
      if (stat.isDirectory()) {
        hash.update(`directory:${relativePath}\0`);
        await visit(absolutePath);
      } else if (stat.isSymbolicLink()) {
        hash.update(`symlink:${relativePath}:${await fs.readlink(absolutePath)}\0`);
      } else if (stat.isFile()) {
        hash.update(`file:${relativePath}:${stat.mode & 0o777}\0`);
        hash.update(await fs.readFile(absolutePath));
        hash.update('\0');
      }
    }
  }

  await visit(root);
  return hash.digest('hex');
}

export class ExtensionService {
  private readonly roots: Required<Pick<ExtensionServiceOptions, 'userRoot'>> & Pick<ExtensionServiceOptions, 'projectRoot'>;
  private readonly loadOptionsProvider?: ExtensionServiceOptions['loadOptions'];

  constructor(options: ExtensionServiceOptions = {}) {
    this.roots = {
      userRoot: options.userRoot ?? AUTOHAND_PATHS.extensions,
      projectRoot: options.projectRoot,
    };
    this.loadOptionsProvider = options.loadOptions;
  }

  async validate(sourcePath: string, scope: ExtensionScope = 'user') {
    return validateExtensionPackage(path.resolve(sourcePath), scope, await this.resolveLoadOptions());
  }

  async list(): Promise<ExtensionSnapshot> {
    return new ExtensionRegistry(this.roots).load(await this.resolveLoadOptions());
  }

  async show(id: string, options: ExtensionMutationOptions = {}): Promise<LoadedExtension | undefined> {
    assertExtensionId(id);
    if (options.scope) {
      const root = pathForScope(this.roots, options.scope);
      const snapshot = await new ExtensionRegistry(
        options.scope === 'user' ? { userRoot: root } : { projectRoot: root },
      ).load();
      return snapshot.extensions.find((extension) => extension.manifest.id === id);
    }
    return (await this.list()).extensions.find((extension) => extension.manifest.id === id);
  }

  async install(sourcePath: string, options: ExtensionInstallOptions = {}): Promise<ExtensionInstallResult> {
    const scope = options.scope ?? 'user';
    const source = await this.validate(sourcePath, scope);
    if (source.runtimes.length > 0 && options.trust !== true) {
      throw new Error(
        `Extension "${source.extension.manifest.id}" contains executable runtime code; reinstall with --trust after reviewing the package`,
      );
    }
    const root = pathForScope(this.roots, scope);
    const destination = path.join(root, source.extension.manifest.id);
    await fs.ensureDir(root);
    const releaseRegistry = await acquireExtensionLock(root, '_registry');

    try {
      await this.assertNoContributionConflicts(source);
      const release = await acquireExtensionLock(root, source.extension.manifest.id);
      try {
        if (await fs.pathExists(destination)) {
          const [sourceHash, destinationHash] = await Promise.all([
            packageFingerprint(source.extension.root),
            packageFingerprint(destination),
          ]);
          if (sourceHash === destinationHash) {
            const existing = (await this.show(source.extension.manifest.id, { scope }))!;
            if (source.runtimes.length > 0 && !existing.trusted) {
              await writeJsonAtomic(statePath(root, source.extension.manifest.id), {
                disabled: existing.disabled,
                linked: existing.linked,
                trusted: true,
              });
            }
            return {
              status: 'existing',
              extension: (await this.show(source.extension.manifest.id, { scope }))!,
            };
          }
          if (!options.replace) {
            throw new Error(
              `Extension "${source.extension.manifest.id}" is already installed with different content; use replace explicitly`,
            );
          }
        }

        const operationId = `${process.pid}-${randomUUID()}`;
        const staging = path.join(root, `.tmp-${source.extension.manifest.id}-${operationId}`);
        const backup = path.join(root, `.backup-${source.extension.manifest.id}-${operationId}`);
        let movedExisting = false;
        try {
          if (options.link) {
            await fs.symlink(source.extension.root, staging, 'dir');
          } else {
            await fs.copy(source.extension.root, staging, { dereference: false, errorOnExist: true });
            await fs.remove(path.join(staging, EXTENSION_STATE_FILE));
          }
          await validateExtensionPackage(staging, scope, await this.resolveLoadOptions());

          if (await fs.pathExists(destination)) {
            await nodeFs.rename(destination, backup);
            movedExisting = true;
          }
          try {
            await nodeFs.rename(staging, destination);
          } catch (error) {
            if (movedExisting) {
              await nodeFs.rename(backup, destination).catch(() => {});
            }
            throw error;
          }
          if (movedExisting) {
            await fs.remove(backup);
          }

          await fs.remove(statePath(root, source.extension.manifest.id));
          if (options.link || source.runtimes.length > 0) {
            await writeJsonAtomic(statePath(root, source.extension.manifest.id), {
              linked: options.link === true,
              trusted: source.runtimes.length > 0 && options.trust === true,
            });
          }

          return {
            status: movedExisting ? 'replaced' : 'installed',
            extension: (await this.show(source.extension.manifest.id, { scope }))!,
          };
        } finally {
          await fs.remove(staging).catch(() => {});
          if (!await fs.pathExists(destination) && movedExisting && await fs.pathExists(backup)) {
            await nodeFs.rename(backup, destination).catch(() => {});
          }
        }
      } finally {
        await release();
      }
    } finally {
      await releaseRegistry();
    }
  }

  async setEnabled(
    id: string,
    enabled: boolean,
    options: ExtensionMutationOptions = {},
  ): Promise<LoadedExtension> {
    const scope = options.scope ?? 'user';
    const root = pathForScope(this.roots, scope);
    assertExtensionId(id);
    const release = await acquireExtensionLock(root, id);
    try {
      const packageRoot = await this.requireInstalledPackage(id, scope);
      const current = await this.show(id, { scope });
      const linked = (await fs.lstat(packageRoot)).isSymbolicLink();
      await writeJsonAtomic(statePath(root, id), {
        disabled: !enabled,
        linked,
        trusted: current?.trusted === true,
      });
      return (await this.show(id, { scope }))!;
    } finally {
      await release();
    }
  }

  async remove(id: string, options: ExtensionMutationOptions = {}): Promise<LoadedExtension> {
    const scope = options.scope ?? 'user';
    const root = pathForScope(this.roots, scope);
    assertExtensionId(id);
    const release = await acquireExtensionLock(root, id);
    try {
      const packageRoot = await this.requireInstalledPackage(id, scope);
      const extension = await this.show(id, { scope })
        ?? (await validateExtensionPackage(packageRoot, scope)).extension;
      const tombstone = path.join(root, `.removed-${id}-${process.pid}-${randomUUID()}`);
      await nodeFs.rename(packageRoot, tombstone);
      await Promise.all([
        fs.remove(tombstone).catch(() => {}),
        fs.remove(statePath(root, id)).catch(() => {}),
      ]);
      return extension;
    } finally {
      await release();
    }
  }

  async doctor(): Promise<ExtensionDoctorReport> {
    const snapshot = await this.list();
    const runtimeDiagnostics = await extensionRuntimeHost.sync(snapshot);
    const diagnostics = [...snapshot.diagnostics, ...runtimeDiagnostics];
    return {
      healthy: diagnostics.length === 0,
      extensions: snapshot.extensions.length,
      diagnostics,
    };
  }

  private async requireInstalledPackage(id: string, scope: ExtensionScope): Promise<string> {
    assertExtensionId(id);
    const root = pathForScope(this.roots, scope);
    const packageRoot = path.join(root, id);
    if (!await fs.pathExists(packageRoot)) {
      throw new Error(`Extension "${id}" is not installed in ${scope} scope`);
    }
    const extensionPackage = await readExtensionPackage(packageRoot);
    if (extensionPackage.manifest.id !== id) {
      throw new Error(`Installed extension id mismatch for "${id}"`);
    }
    return packageRoot;
  }

  private async resolveLoadOptions(): Promise<ExtensionLoadOptions> {
    if (typeof this.loadOptionsProvider === 'function') {
      return this.loadOptionsProvider();
    }
    return this.loadOptionsProvider ?? {};
  }

  private async assertNoContributionConflicts(source: ValidatedExtensionPackage): Promise<void> {
    const snapshot = await this.list();
    const extensionId = source.extension.manifest.id;
    const activeTools = new Map(snapshot.tools.map((tool) => [
      tool.definition.name,
      tool.provenance.extensionId,
    ]));
    const activeAgents = new Map(snapshot.agents.map((agent) => [
      agent.name,
      agent.provenance.extensionId,
    ]));
    const activeSkills = new Map(snapshot.skills.map((skill) => [
      skill.definition.name,
      skill.provenance.extensionId,
    ]));

    for (const tool of source.tools) {
      const owner = activeTools.get(tool.definition.name);
      if (owner && owner !== extensionId) {
        throw new Error(
          `Contribution "${tool.definition.name}" conflicts with installed extension "${owner}"`,
        );
      }
    }
    for (const agent of source.agents) {
      const owner = activeAgents.get(agent.name);
      if (owner && owner !== extensionId) {
        throw new Error(`Contribution "${agent.name}" conflicts with installed extension "${owner}"`);
      }
    }
    for (const skill of source.skills) {
      const owner = activeSkills.get(skill.definition.name);
      if (owner && owner !== extensionId) {
        throw new Error(
          `Contribution "${skill.definition.name}" conflicts with installed extension "${owner}"`,
        );
      }
    }
  }
}
