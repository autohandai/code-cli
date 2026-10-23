import { minimatch } from 'minimatch';
import type { ExtensionRuntimeHook } from '../../extensions/ExtensionRuntimeHost.js';

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Workflow skill hook must be an object.');
  }
  return value as Record<string, unknown>;
}

function patterns(value: unknown): string[] {
  if (!Array.isArray(value) || value.length > 100 || value.some(item => typeof item !== 'string' || item.length > 1024)) {
    throw new Error('Workflow skill hook filters must be bounded string arrays.');
  }
  return value.slice();
}

export function parseWorkflowSkillHooks(value: unknown): ExtensionRuntimeHook[] {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > 100) throw new Error('Expected at most 100 workflow skill hooks.');
  let contextBytes = 0;
  return value.map((item, index) => {
    const hook = record(item);
    if (Object.keys(hook).some(key => !['event', 'skill', 'context', 'filter'].includes(key))) {
      throw new Error('Unsupported workflow skill hook option.');
    }
    const { event, skill, context } = hook;
    if (event !== 'pre-prompt' && event !== 'file-modified' && event !== 'context:compact' && event !== 'pre-tool' && event !== 'post-tool') {
      throw new Error('Unsupported workflow skill hook event.');
    }
    if (typeof skill !== 'string' || !/^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,99}$/.test(skill)) throw new Error('Invalid workflow skill name.');
    if (typeof context !== 'string' || !context.trim() || Buffer.byteLength(context) > 65536) throw new Error('Invalid workflow skill context.');
    contextBytes += Buffer.byteLength(context);
    if (contextBytes > 262144) throw new Error('Workflow skill contexts exceed 256 KiB.');
    const filter = hook.filter === undefined ? {} : record(hook.filter);
    if (Object.keys(filter).some(key => key !== 'tool' && key !== 'path')) throw new Error('Unsupported workflow skill hook filter.');
    const tools = filter.tool === undefined ? [] : patterns(filter.tool);
    const paths = filter.path === undefined ? [] : patterns(filter.path);
    let delivered = false;
    return {
      event,
      extensionId: `autohand-workflow:${skill}:${index}`,
      handler(input) {
        if (tools.length && (!input.tool || !tools.includes(input.tool))) return;
        if (paths.length && (!input.path || !paths.some(pattern => minimatch(input.path!, pattern)))) return;
        if (delivered && event !== 'context:compact') return;
        delivered = true;
        return { additionalContext: context };
      },
    };
  });
}
