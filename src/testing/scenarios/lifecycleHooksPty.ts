import { hooks } from '../../commands/hooks.js';
import { HookManager } from '../../core/HookManager.js';

const manager = new HookManager({ workspaceRoot: process.cwd(), settings: { hooks: [
  { event: 'session-start', command: 'echo configured', description: 'Configured start hook' },
] } });
manager.setExtensionHooks([{ event: 'session-start', extensionId: 'example.plugin', handler: () => {} }]);
await hooks({ hookManager: manager, authoring: { create: async () => ({ status: 'cancelled' }) } });
process.stdout.write('HOOK_MENU_CLOSED\n');
