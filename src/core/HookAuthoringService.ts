import fs from 'fs-extra';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { Script } from 'node:vm';
import { z } from 'zod';
import { AUTOHAND_HOME } from '../constants.js';
import type { HookDefinition, HookEvent } from '../types.js';
import type { LLMProvider } from '../providers/LLMProvider.js';
import type { HookManager } from './HookManager.js';
import { canonicalHookEvent, EVENT_DESCRIPTIONS, HOOK_EVENTS } from './hookEvents.js';

const draftSchema = z.object({
  event: z.enum(HOOK_EVENTS),
  description: z.string().trim().min(1).max(240),
  script: z.string().trim().min(1).max(32_000),
  timeout: z.number().int().min(100).max(120_000).default(5000),
  async: z.boolean().default(false),
  filter: z.object({
    tool: z.array(z.string().min(1)).max(100).optional(),
    path: z.array(z.string().min(1)).max(100).optional(),
  }).optional(),
});

export interface HookAuthoringRequest {
  event?: HookEvent;
  prompt: string;
}

export interface HookAuthoringOptions {
  manager: HookManager;
  workspaceRoot: string;
  scriptsRoot?: string;
  getProvider: () => LLMProvider;
  confirm: (preview: string) => Promise<boolean>;
  requireAutohand?: boolean;
}

export type HookAuthoringResult = { status: 'cancelled' } | {
  status: 'created'; hook: HookDefinition; scriptPath: string; active: boolean;
};

export class HookAuthoringService {
  constructor(private readonly options: HookAuthoringOptions) {}

  private checkProvider(): void {
    if (this.options.requireAutohand && this.options.getProvider().getName() !== 'autohandai') {
      throw new Error('Lifecycle hook tools are available only with the Autohand AI provider.');
    }
  }

  async create(request: HookAuthoringRequest, signal?: AbortSignal): Promise<HookAuthoringResult> {
    this.checkProvider();
    const prompt = z.string().trim().min(1).max(8000).parse(request.prompt);
    const selectedEvent = request.event === undefined ? undefined : canonicalHookEvent(z.enum(HOOK_EVENTS).parse(request.event));
    const response = await this.options.getProvider().complete({
      messages: [{ role: 'system', content: [
        'Create one Autohand lifecycle hook from the user request. Return ONLY a JSON object with event, description, script, timeout (100-120000 ms), async (boolean), and optional filter {tool: string[], path: string[]}.',
        'script is a Node.js CommonJS script body, without markdown or a shebang. Use only built-in Node modules and existing workspace commands. Do not install dependencies. Do not execute anything while authoring.',
        'The script will be scoped to the current workspace automatically. cwd is the workspace. Node.js is the script runtime on all platforms.',
        'The wrapper provides parsed JSON stdin as the hookContext object. Use hookContext or process.env.HOOK_EVENT, HOOK_WORKSPACE, HOOK_TOOL, HOOK_PATH, HOOK_SUCCESS, HOOK_INSTRUCTION, HOOK_SESSION_ID, HOOK_ERROR. Do not read stdin yourself. Optional fields may be absent. Never interpolate untrusted context into shell strings; use execFile with argument arrays.',
        'Exit 0 for success, 2 to block pre-tool/permission-request. stdout may contain JSON {decision:"allow"|"deny"|"ask"|"block", reason:string, additionalContext:string}. Only grant permissions or perform destructive actions if explicitly requested. Do not embed credentials; read named environment variables.',
        `hookContext uses these exact field names (absent when unavailable for the chosen event): ${this.options.manager.getContextFields().join(', ')}.`,
        'Use async false for guards. Prefer filters for tool/path-specific work. Be faithful to the request and avoid extra side effects.',
        `Available events: ${JSON.stringify(EVENT_DESCRIPTIONS)}.`,
        selectedEvent ? `The event MUST be ${selectedEvent}.` : 'Choose the event that matches the requested trigger.',
      ].join('\n') }, { role: 'user', content: prompt }],
      maxTokens: 6000, temperature: 0.2, signal,
    });
    signal?.throwIfAborted();
    this.checkProvider();
    const draft = draftSchema.parse(JSON.parse(response.content.trim().replace(/^```(?:json)?\s*|\s*```$/g, '')));
    draft.event = canonicalHookEvent(draft.event);
    if (selectedEvent && draft.event !== selectedEvent) throw new Error(`Generated hook must use ${selectedEvent}.`);
    const workspace = await fs.realpath(this.options.workspaceRoot);
    const script = [
      "'use strict';",
      '(async () => {',
      "const hookContext = JSON.parse(require('node:fs').readFileSync(0, 'utf8'));",
      `if (require('node:fs').realpathSync(process.cwd()) !== ${JSON.stringify(workspace)}) return;`,
      draft.script,
      '})().catch(error => { console.error(error.message); process.exitCode = 1; });', '',
    ].join('\n');
    new Script(script, { filename: 'lifecycle-hook.cjs' });
    const scriptsRoot = this.options.scriptsRoot ?? path.join(AUTOHAND_HOME, 'hooks', 'generated');
    const scriptPath = path.join(scriptsRoot, `${draft.event.replace(/:/g, '-')}-${randomUUID()}.cjs`);
    if (process.platform === 'win32' && /["%\r\n]/.test(scriptPath)) throw new Error('Hook script directory contains unsupported shell characters.');
    const quotedPath = process.platform === 'win32' ? `"${scriptPath}"` : `'${scriptPath.replace(/'/g, "'\\''")}'`;
    const hook: HookDefinition = {
      event: draft.event, command: `node ${quotedPath}`, description: draft.description,
      enabled: true, timeout: draft.timeout, async: draft.async, ...(draft.filter ? { filter: draft.filter } : {}),
    };
    const preview = [
      `Create lifecycle hook: ${draft.description}`, `Event: ${hook.event}`, `Workspace: ${workspace}`,
      `Script: ${scriptPath}`, `Command: ${hook.command}`, `Timeout: ${hook.timeout}ms · ${hook.async ? 'Background' : 'Synchronous'}`,
      `Filters: ${JSON.stringify(hook.filter ?? {})}`,
      this.options.manager.isEnabled() ? 'Enabled for future matching events.' : 'Saved enabled; global hooks are disabled.',
      '', script,
    ].join('\n');
    if (!await this.options.confirm(preview)) return { status: 'cancelled' };
    signal?.throwIfAborted();
    this.checkProvider();
    await fs.ensureDir(scriptsRoot);
    await fs.writeFile(scriptPath, script, { flag: 'wx', mode: 0o600 });
    try {
      await this.options.manager.addHook(hook);
    } catch (error) {
      await fs.remove(scriptPath);
      throw error;
    }
    return { status: 'created', hook, scriptPath, active: this.options.manager.isEnabled() };
  }
}
