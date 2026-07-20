/**
 * @license
 * Copyright 2026 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import fs from 'fs-extra';
import { Option, type Command } from 'commander';
import * as Ink from 'ink';
import React, { type ComponentType } from 'react';
import { pathToFileURL } from 'node:url';
import type { HookContext } from '../core/HookManager.js';
import type { LineExtension, LineSegmentColor } from '../ui/ink/StatusLine.js';
import type { LLMProvider } from '../providers/LLMProvider.js';
import type {
  AutohandConfig,
  HookEvent,
  HookResponse,
} from '../types.js';
import type { PermissionSettings } from '../permissions/types.js';
import type {
  ExtensionDiagnostic,
  ExtensionSnapshot,
  LoadedExtension,
} from './types.js';

export interface ExtensionCliFlag {
  flags: string;
  description: string;
  defaultValue?: string | boolean;
  extensionId: string;
}

export interface ExtensionCommandContext {
  args: string[];
  workspaceRoot: string;
  isNonInteractive: boolean;
  cli: {
    getOption(name: string): unknown;
  };
  ui: {
    open(viewId: string, props?: Record<string, unknown>): ExtensionViewRequest;
  };
}

export interface ExtensionViewRequest {
  type: 'extension-view';
  viewId: string;
  props?: Record<string, unknown>;
}

export type ExtensionCommandResult = string | ExtensionViewRequest | null | void;

export interface ExtensionRuntimeCommand {
  command: string;
  description: string;
  extensionId: string;
  execute(context: ExtensionCommandContext): Promise<ExtensionCommandResult> | ExtensionCommandResult;
}

export interface ExtensionViewProps {
  close(value?: string): void;
  workspaceRoot: string;
  args: string[];
}

export interface ExtensionRuntimeView {
  id: string;
  title: string;
  component: ComponentType<ExtensionViewProps & Record<string, unknown>>;
  extensionId: string;
}

export interface ExtensionKeybinding {
  key: string;
  command: string;
  extensionId: string;
  when?: 'always' | 'input-empty';
}

export interface ExtensionRuntimeHook {
  event: HookEvent;
  extensionId: string;
  handler(context: HookContext): Promise<HookResponse | void> | HookResponse | void;
}

export interface ExtensionRuntimeProvider {
  name: `extension:${string}`;
  displayName: string;
  extensionId: string;
  create(config: Record<string, unknown> & { model: string }, rootConfig: AutohandConfig): LLMProvider;
}

export type ExtensionPermissionSettings = Omit<PermissionSettings, 'mode' | 'rememberSession'>;

export interface ExtensionPermissionPolicy {
  extensionId: string;
  settings: ExtensionPermissionSettings;
}

interface RuntimeModule {
  activate?: (api: ExtensionRuntimeAPI) => void | (() => void | Promise<void>) | Promise<void | (() => void | Promise<void>)>;
  deactivate?: () => void | Promise<void>;
  default?:
    | ((api: ExtensionRuntimeAPI) => void | (() => void | Promise<void>) | Promise<void | (() => void | Promise<void>)>)
    | { activate?: RuntimeModule['activate']; deactivate?: RuntimeModule['deactivate'] };
}

interface RuntimeCollector {
  commands: ExtensionRuntimeCommand[];
  views: ExtensionRuntimeView[];
  statusLines: LineExtension[];
  helpLines: LineExtension[];
  keybindings: ExtensionKeybinding[];
  cliFlags: ExtensionCliFlag[];
  hooks: ExtensionRuntimeHook[];
  providers: ExtensionRuntimeProvider[];
  permissionPolicies: ExtensionPermissionPolicy[];
  deactivators: Array<() => void | Promise<void>>;
}

export interface ExtensionRuntimeAPI {
  readonly version: 1;
  readonly extension: {
    id: string;
    version: string;
    root: string;
    scope: 'user' | 'project';
  };
  readonly commands: {
    register(command: Omit<ExtensionRuntimeCommand, 'extensionId'>): void;
  };
  readonly ui: {
    React: typeof React;
    Ink: typeof Ink;
    setStatusLine(extension: LineExtension): void;
    setHelpLine(extension: LineExtension): void;
    registerView<Props extends Record<string, unknown>>(
      view: Omit<ExtensionRuntimeView, 'extensionId' | 'component'> & {
        component: ComponentType<ExtensionViewProps & Props>;
      }
    ): void;
  };
  readonly keybindings: {
    register(keybinding: Omit<ExtensionKeybinding, 'extensionId'>): void;
  };
  readonly cli: {
    registerFlag(flag: Omit<ExtensionCliFlag, 'extensionId'>): void;
    getOption(name: string): unknown;
  };
  readonly hooks: {
    on(event: HookEvent, handler: ExtensionRuntimeHook['handler']): void;
  };
  readonly providers: {
    register(provider: Omit<ExtensionRuntimeProvider, 'extensionId'>): void;
  };
  readonly permissions: {
    registerPolicy(settings: ExtensionPermissionSettings): void;
  };
}

export interface ExtensionRuntimeHostOptions {
  reservedCommands?: Iterable<string>;
  reservedProviders?: Iterable<string>;
  reservedKeybindings?: Iterable<string>;
  reservedCliFlags?: Iterable<string>;
}

const COMMAND_PATTERN = /^\/[a-z][a-z0-9-]*$/;
const VIEW_ID_PATTERN = /^[a-z][a-z0-9-]*(?:\.[a-z0-9-]+)+$/;
const PROVIDER_PATTERN = /^extension:[a-z][a-z0-9-]*(?:[.-][a-z0-9-]+)*$/;
const KEYBINDING_PATTERN = /^(?:(?:ctrl|meta|shift|alt)\+)+(?:[a-z0-9]|tab|space|up|down|left|right|f(?:[1-9]|1[0-2]))$/;
const RESERVED_KEYBINDINGS = new Set([
  'ctrl+c',
  'ctrl+d',
  'escape',
  'enter',
  'return',
  'shift+tab',
]);
const LINE_SEGMENT_COLORS = new Set<LineSegmentColor>([
  'text',
  'muted',
  'accent',
  'success',
  'warning',
  'error',
  'dim',
]);
const HOOK_EVENTS = new Set<HookEvent>([
  'pre-tool',
  'post-tool',
  'file-modified',
  'pre-prompt',
  'stop',
  'post-response',
  'session-error',
  'subagent-stop',
  'session-start',
  'session-end',
  'pre-clear',
  'permission-request',
  'notification',
  'automode:start',
  'automode:iteration',
  'automode:checkpoint',
  'automode:pause',
  'automode:resume',
  'automode:cancel',
  'automode:complete',
  'automode:error',
  'autoresearch:start',
  'autoresearch:pause',
  'autoresearch:init',
  'autoresearch:before',
  'autoresearch:run',
  'autoresearch:after',
  'autoresearch:log',
  'autoresearch:decision',
  'autoresearch:replay',
  'autoresearch:rescore',
  'autoresearch:prune',
  'autoresearch:complete',
  'autoresearch:error',
  'pre-learn',
  'post-learn',
  'goal-written:completed',
  'team-created',
  'teammate-spawned',
  'teammate-idle',
  'task-assigned',
  'task-completed',
  'team-shutdown',
  'review:start',
  'review:end',
  'review:paused',
  'review:failed',
  'review:completed',
  'mode-change',
  'context:compact',
  'context:overflow',
  'context:warning',
  'context:critical',
]);

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function assertNonEmptyString(value: unknown, label: string): asserts value is string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error(`${label} must be a non-empty string`);
  }
}

function assertLineExtension(value: LineExtension, label: string): void {
  if (!isPlainRecord(value)) {
    throw new Error(`${label} must be an object`);
  }
  if (value.segments !== undefined && !Array.isArray(value.segments)) {
    throw new Error(`${label}.segments must be an array`);
  }
  for (const segment of value.segments ?? []) {
    assertNonEmptyString(segment.id, `${label} segment id`);
    if (typeof segment.text !== 'string') {
      throw new Error(`${label} segment "${segment.id}" text must be a string`);
    }
    if (segment.color !== undefined && !LINE_SEGMENT_COLORS.has(segment.color)) {
      throw new Error(`${label} segment "${segment.id}" has an invalid color`);
    }
    if (segment.visible !== undefined && typeof segment.visible !== 'boolean') {
      throw new Error(`${label} segment "${segment.id}" visible must be boolean`);
    }
  }
  assertUnique((value.segments ?? []).map((segment) => segment.id), `${label} segment id`);
  if (value.hiddenDefaultSegmentIds !== undefined
    && (!Array.isArray(value.hiddenDefaultSegmentIds)
      || value.hiddenDefaultSegmentIds.some((id) => typeof id !== 'string'))) {
    throw new Error(`${label}.hiddenDefaultSegmentIds must be a string array`);
  }
  if (value.replaceDefault !== undefined && typeof value.replaceDefault !== 'boolean') {
    throw new Error(`${label}.replaceDefault must be boolean`);
  }
  if (value.separator !== undefined && typeof value.separator !== 'string') {
    throw new Error(`${label}.separator must be a string`);
  }
}

function assertPermissionPolicy(settings: ExtensionPermissionSettings): void {
  if (!isPlainRecord(settings)) {
    throw new Error('Runtime permission policy must be an object');
  }
  const stringArrays = ['allowList', 'denyList', 'whitelist', 'blacklist'] as const;
  for (const field of stringArrays) {
    const value = settings[field];
    if (value !== undefined
      && (!Array.isArray(value) || value.some((entry) => typeof entry !== 'string'))) {
      throw new Error(`Runtime permission policy ${field} must be a string array`);
    }
  }
  const patternArrays = [
    'allowPatterns',
    'denyPatterns',
    'availableTools',
    'excludedTools',
  ] as const;
  for (const field of patternArrays) {
    const value = settings[field];
    if (value !== undefined && (!Array.isArray(value) || value.some((entry) => (
      !isPlainRecord(entry)
      || typeof entry.kind !== 'string'
      || entry.kind.trim().length === 0
      || (entry.argument !== undefined && typeof entry.argument !== 'string')
    )))) {
      throw new Error(`Runtime permission policy ${field} contains an invalid tool pattern`);
    }
  }
  if (settings.rules !== undefined && (!Array.isArray(settings.rules) || settings.rules.some((rule) => (
    !isPlainRecord(rule)
    || typeof rule.tool !== 'string'
    || !['allow', 'deny', 'prompt'].includes(String(rule.action))
    || (rule.pattern !== undefined && typeof rule.pattern !== 'string')
  )))) {
    throw new Error('Runtime permission policy rules contain an invalid rule');
  }
  for (const field of ['allPathsAllowed', 'allUrlsAllowed'] as const) {
    if (settings[field] !== undefined && typeof settings[field] !== 'boolean') {
      throw new Error(`Runtime permission policy ${field} must be boolean`);
    }
  }
  const unsupported = settings as ExtensionPermissionSettings & {
    mode?: unknown;
    rememberSession?: unknown;
  };
  if (unsupported.mode !== undefined || unsupported.rememberSession !== undefined) {
    throw new Error('Runtime permission policies cannot replace the session mode or decision cache');
  }
}

function mergeLineExtensions(extensions: LineExtension[]): LineExtension | undefined {
  if (extensions.length === 0) {
    return undefined;
  }
  const separator = [...extensions].reverse().find((extension) => extension.separator !== undefined)?.separator;
  return {
    replaceDefault: extensions.some((extension) => extension.replaceDefault === true),
    hiddenDefaultSegmentIds: Array.from(new Set(
      extensions.flatMap((extension) => extension.hiddenDefaultSegmentIds ?? []),
    )),
    segments: extensions.flatMap((extension) => extension.segments ?? []),
    separator,
  };
}

function emptyCollector(): RuntimeCollector {
  return {
    commands: [],
    views: [],
    statusLines: [],
    helpLines: [],
    keybindings: [],
    cliFlags: [],
    hooks: [],
    providers: [],
    permissionPolicies: [],
    deactivators: [],
  };
}

function assertUnique(values: string[], label: string): void {
  const duplicate = values.find((value, index) => values.indexOf(value) !== index);
  if (duplicate) {
    throw new Error(`Duplicate runtime ${label} "${duplicate}"`);
  }
}

function longFlagName(flags: string): string {
  const match = flags.match(/(?:^|[,| ]+)(--[a-z][a-z0-9-]*)/);
  if (!match) {
    throw new Error(`Extension CLI flag must declare a long --kebab-case option: ${flags}`);
  }
  return match[1];
}

function runtimeSignature(snapshot: ExtensionSnapshot): Promise<string> {
  return Promise.all(snapshot.runtimes.map(async (runtime) => {
    const extension = snapshot.extensions.find((candidate) =>
      candidate.manifest.id === runtime.provenance.extensionId);
    const stat = await fs.stat(runtime.file).catch(() => null);
    return [
      runtime.provenance.extensionId,
      runtime.file,
      stat?.mtimeMs ?? 'missing',
      extension?.trusted === true,
      extension?.disabled === true,
    ].join(':');
  })).then((parts) => parts.sort().join('|'));
}

export class ExtensionRuntimeHost {
  private commands: ExtensionRuntimeCommand[] = [];
  private views: ExtensionRuntimeView[] = [];
  private statusLines: LineExtension[] = [];
  private helpLines: LineExtension[] = [];
  private keybindings: ExtensionKeybinding[] = [];
  private cliFlags: ExtensionCliFlag[] = [];
  private hooks: ExtensionRuntimeHook[] = [];
  private providers: ExtensionRuntimeProvider[] = [];
  private permissionPolicies: ExtensionPermissionPolicy[] = [];
  private deactivators: Array<() => void | Promise<void>> = [];
  private cliOptions: Record<string, unknown> = {};
  private signature = '';
  private diagnostics: ExtensionDiagnostic[] = [];
  private readonly reservedCommands: Set<string>;
  private readonly reservedProviders: Set<string>;
  private readonly reservedKeybindings: Set<string>;
  private readonly reservedCliFlags: Set<string>;

  constructor(options: ExtensionRuntimeHostOptions = {}) {
    this.reservedCommands = new Set(options.reservedCommands ?? []);
    this.reservedProviders = new Set(options.reservedProviders ?? []);
    this.reservedKeybindings = new Set([
      ...RESERVED_KEYBINDINGS,
      ...(options.reservedKeybindings ?? []),
    ]);
    this.reservedCliFlags = new Set(options.reservedCliFlags ?? []);
  }

  setReservedCapabilities(options: ExtensionRuntimeHostOptions): void {
    for (const command of options.reservedCommands ?? []) {
      this.reservedCommands.add(command);
    }
    for (const provider of options.reservedProviders ?? []) {
      this.reservedProviders.add(provider);
    }
    for (const keybinding of options.reservedKeybindings ?? []) {
      this.reservedKeybindings.add(keybinding.toLowerCase());
    }
    for (const flag of options.reservedCliFlags ?? []) {
      this.reservedCliFlags.add(flag);
    }
  }

  async sync(snapshot: ExtensionSnapshot): Promise<ExtensionDiagnostic[]> {
    const signature = await runtimeSignature(snapshot);
    if (signature === this.signature) {
      return [...this.diagnostics];
    }

    await this.deactivateAll();
    this.signature = signature;
    const diagnostics: ExtensionDiagnostic[] = [];
    const runtimesByExtension = new Map<string, typeof snapshot.runtimes>();
    for (const runtime of snapshot.runtimes) {
      const values = runtimesByExtension.get(runtime.provenance.extensionId) ?? [];
      values.push(runtime);
      runtimesByExtension.set(runtime.provenance.extensionId, values);
    }

    for (const extension of snapshot.extensions
      .filter((candidate) => !candidate.disabled && runtimesByExtension.has(candidate.manifest.id))
      .sort((left, right) => left.manifest.id.localeCompare(right.manifest.id))) {
      if (!extension.trusted) {
        diagnostics.push(this.diagnostic(
          extension,
          'runtime_untrusted',
          'Runtime entrypoints are installed but not trusted; reinstall with --trust after review',
        ));
        continue;
      }

      const collector = emptyCollector();
      try {
        const api = this.createAPI(extension, collector);
        for (const runtime of runtimesByExtension.get(extension.manifest.id) ?? []) {
          const stat = await fs.stat(runtime.file);
          const moduleUrl = `${pathToFileURL(runtime.file).href}?mtime=${stat.mtimeMs}`;
          const module = await import(moduleUrl) as RuntimeModule;
          const defaultExport = module.default;
          const activate = module.activate
            ?? (typeof defaultExport === 'function' ? defaultExport : defaultExport?.activate);
          const deactivate = module.deactivate
            ?? (typeof defaultExport === 'object' ? defaultExport?.deactivate : undefined);
          if (typeof activate !== 'function') {
            throw new Error(`Runtime entrypoint does not export activate(api) or a default activation function: ${runtime.file}`);
          }
          const returnedDeactivate = await activate(api);
          if (typeof returnedDeactivate === 'function') {
            collector.deactivators.push(returnedDeactivate);
          }
          if (typeof deactivate === 'function') {
            collector.deactivators.push(deactivate);
          }
        }
        this.commit(extension, collector);
      } catch (error) {
        for (const deactivate of collector.deactivators.reverse()) {
          await Promise.resolve(deactivate()).catch(() => {});
        }
        diagnostics.push(this.diagnostic(
          extension,
          'runtime_activation_failed',
          `Runtime activation failed: ${errorMessage(error)}`,
        ));
      }
    }

    this.diagnostics = diagnostics;
    return [...diagnostics];
  }

  async deactivateAll(): Promise<void> {
    const deactivators = this.deactivators.splice(0).reverse();
    await Promise.allSettled(deactivators.map((deactivate) => Promise.resolve(deactivate())));
    this.commands = [];
    this.views = [];
    this.statusLines = [];
    this.helpLines = [];
    this.keybindings = [];
    this.cliFlags = [];
    this.hooks = [];
    this.providers = [];
    this.permissionPolicies = [];
    this.diagnostics = [];
    this.signature = '';
  }

  setCliOptions(options: Record<string, unknown>): void {
    this.cliOptions = { ...options };
  }

  getCliOption(name: string): unknown {
    return this.cliOptions[name];
  }

  getCommands(): ExtensionRuntimeCommand[] {
    return [...this.commands];
  }

  getCommand(command: string): ExtensionRuntimeCommand | undefined {
    return this.commands.find((candidate) => candidate.command === command);
  }

  getViews(): ExtensionRuntimeView[] {
    return [...this.views];
  }

  getView(id: string): ExtensionRuntimeView | undefined {
    return this.views.find((candidate) => candidate.id === id);
  }

  getLineExtensions(): { status?: LineExtension; help?: LineExtension } {
    return {
      status: mergeLineExtensions(this.statusLines),
      help: mergeLineExtensions(this.helpLines),
    };
  }

  getKeybindings(): ExtensionKeybinding[] {
    return [...this.keybindings];
  }

  getCliFlags(): ExtensionCliFlag[] {
    return [...this.cliFlags];
  }

  getHooks(): ExtensionRuntimeHook[] {
    return [...this.hooks];
  }

  getProviders(): ExtensionRuntimeProvider[] {
    return [...this.providers];
  }

  getProvider(name: string): ExtensionRuntimeProvider | undefined {
    return this.providers.find((provider) => provider.name === name);
  }

  getPermissionPolicies(): ExtensionPermissionPolicy[] {
    return [...this.permissionPolicies];
  }

  createViewRequest(viewId: string, props?: Record<string, unknown>): ExtensionViewRequest {
    if (!this.getView(viewId)) {
      throw new Error(`Unknown extension view "${viewId}"`);
    }
    return { type: 'extension-view', viewId, props };
  }

  private createAPI(extension: LoadedExtension, collector: RuntimeCollector): ExtensionRuntimeAPI {
    const own = <T extends object>(value: T): T & { extensionId: string } => ({
      ...value,
      extensionId: extension.manifest.id,
    });

    return {
      version: 1,
      extension: {
        id: extension.manifest.id,
        version: extension.manifest.version,
        root: extension.root,
        scope: extension.scope,
      },
      commands: {
        register: (command) => collector.commands.push(own(command)),
      },
      ui: {
        React,
        Ink,
        setStatusLine: (line) => collector.statusLines.push(line),
        setHelpLine: (line) => collector.helpLines.push(line),
        registerView: (view) => collector.views.push(own({
          ...view,
          component: view.component as ComponentType<ExtensionViewProps & Record<string, unknown>>,
        })),
      },
      keybindings: {
        register: (keybinding) => collector.keybindings.push(own(keybinding)),
      },
      cli: {
        registerFlag: (flag) => collector.cliFlags.push(own(flag)),
        getOption: (name) => this.getCliOption(name),
      },
      hooks: {
        on: (event, handler) => collector.hooks.push({
          event,
          handler,
          extensionId: extension.manifest.id,
        }),
      },
      providers: {
        register: (provider) => collector.providers.push(own(provider)),
      },
      permissions: {
        registerPolicy: (settings) => collector.permissionPolicies.push({
          settings,
          extensionId: extension.manifest.id,
        }),
      },
    };
  }

  private commit(extension: LoadedExtension, collector: RuntimeCollector): void {
    assertUnique(collector.commands.map((value) => value.command), 'command');
    assertUnique(collector.views.map((value) => value.id), 'view');
    assertUnique(collector.keybindings.map((value) => value.key), 'keybinding');
    assertUnique(collector.cliFlags.map((value) => longFlagName(value.flags)), 'CLI flag');
    assertUnique(collector.providers.map((value) => value.name), 'provider');

    for (const command of collector.commands) {
      if (!COMMAND_PATTERN.test(command.command)) {
        throw new Error(`Invalid runtime command "${command.command}"`);
      }
      assertNonEmptyString(command.description, `Runtime command "${command.command}" description`);
      if (typeof command.execute !== 'function') {
        throw new Error(`Runtime command "${command.command}" execute must be a function`);
      }
      if (this.reservedCommands.has(command.command) || this.getCommand(command.command)) {
        throw new Error(`Runtime command "${command.command}" conflicts with an existing command`);
      }
    }
    for (const view of collector.views) {
      if (!VIEW_ID_PATTERN.test(view.id) || typeof view.component !== 'function') {
        throw new Error(`Invalid runtime view "${view.id}"`);
      }
      assertNonEmptyString(view.title, `Runtime view "${view.id}" title`);
      if (this.getView(view.id)) {
        throw new Error(`Runtime view "${view.id}" conflicts with an existing view`);
      }
    }
    collector.statusLines.forEach((line) => assertLineExtension(line, 'Runtime status line'));
    collector.helpLines.forEach((line) => assertLineExtension(line, 'Runtime help line'));
    for (const keybinding of collector.keybindings) {
      const normalized = keybinding.key.toLowerCase();
      if (!KEYBINDING_PATTERN.test(normalized) || this.reservedKeybindings.has(normalized)) {
        throw new Error(`Runtime keybinding "${keybinding.key}" is invalid or reserved`);
      }
      if (!collector.commands.some((command) => command.command === keybinding.command)
        && !this.getCommand(keybinding.command)) {
        throw new Error(`Runtime keybinding "${keybinding.key}" references unknown command "${keybinding.command}"`);
      }
      if (keybinding.when !== undefined
        && keybinding.when !== 'always'
        && keybinding.when !== 'input-empty') {
        throw new Error(`Runtime keybinding "${keybinding.key}" has an invalid when condition`);
      }
      keybinding.key = normalized;
    }
    for (const flag of collector.cliFlags) {
      const longName = longFlagName(flag.flags);
      assertNonEmptyString(flag.description, `Runtime CLI flag "${longName}" description`);
      const option = new Option(flag.flags, flag.description);
      const coreConflict = [option.short, option.long]
        .find((name) => name !== undefined && this.reservedCliFlags.has(name));
      if (coreConflict) {
        throw new Error(`Runtime CLI flag "${coreConflict}" conflicts with a core option`);
      }
      if (this.cliFlags.some((candidate) => {
        const existing = new Option(candidate.flags);
        return option.long === existing.long
          || (option.short !== undefined && option.short === existing.short);
      })) {
        throw new Error(`Runtime CLI flag "${longName}" conflicts with an existing flag`);
      }
    }
    for (const hook of collector.hooks) {
      if (!HOOK_EVENTS.has(hook.event) || typeof hook.handler !== 'function') {
        throw new Error(`Invalid runtime hook event "${hook.event}"`);
      }
    }
    for (const provider of collector.providers) {
      if (!PROVIDER_PATTERN.test(provider.name)) {
        throw new Error(`Runtime provider "${provider.name}" must use the extension:<id> namespace`);
      }
      assertNonEmptyString(provider.displayName, `Runtime provider "${provider.name}" displayName`);
      if (typeof provider.create !== 'function') {
        throw new Error(`Runtime provider "${provider.name}" create must be a function`);
      }
      if (this.reservedProviders.has(provider.name) || this.getProvider(provider.name)) {
        throw new Error(`Runtime provider "${provider.name}" conflicts with an existing provider`);
      }
    }
    for (const policy of collector.permissionPolicies) {
      assertPermissionPolicy(policy.settings);
    }

    this.commands.push(...collector.commands);
    this.views.push(...collector.views);
    this.statusLines.push(...collector.statusLines);
    this.helpLines.push(...collector.helpLines);
    this.keybindings.push(...collector.keybindings);
    this.cliFlags.push(...collector.cliFlags);
    this.hooks.push(...collector.hooks);
    this.providers.push(...collector.providers);
    this.permissionPolicies.push(...collector.permissionPolicies);
    this.deactivators.push(...collector.deactivators);

    if (collector.commands.length === 0
      && collector.views.length === 0
      && collector.statusLines.length === 0
      && collector.helpLines.length === 0
      && collector.keybindings.length === 0
      && collector.cliFlags.length === 0
      && collector.hooks.length === 0
      && collector.providers.length === 0
      && collector.permissionPolicies.length === 0) {
      throw new Error(`Runtime extension "${extension.manifest.id}" registered no capabilities`);
    }
  }

  private diagnostic(
    extension: LoadedExtension,
    code: ExtensionDiagnostic['code'],
    message: string,
  ): ExtensionDiagnostic {
    return {
      code,
      message,
      extensionId: extension.manifest.id,
      scope: extension.scope,
      file: extension.manifestPath,
    };
  }
}

export function registerExtensionCliFlags(program: Command, host: ExtensionRuntimeHost): void {
  for (const flag of host.getCliFlags()) {
    const extensionOption = new Option(flag.flags);
    const conflict = program.options.find((option) =>
      option.long === extensionOption.long
      || (extensionOption.short !== undefined && option.short === extensionOption.short));
    if (conflict) {
      throw new Error(`Extension "${flag.extensionId}" CLI flag "${conflict.long}" conflicts with a core option`);
    }
    program.option(flag.flags, flag.description, flag.defaultValue);
  }
}

export const extensionRuntimeHost = new ExtensionRuntimeHost();
