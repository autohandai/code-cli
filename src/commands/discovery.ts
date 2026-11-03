/** @license Apache-2.0 */
import { runDiscoveryPreview } from '../discovery/preview.js';

export const metadata = {
  command: '/discovery',
  description: 'preview useful workflows from the current workspace',
  implemented: true,
};

export async function discovery(ctx: { workspaceRoot: string; commandSignal?: AbortSignal }, args: string[] = []): Promise<string> {
  if (args.length) return 'Usage: /discovery\nPreviews the current workspace locally without writing drafts or making model requests.';
  try {
    return await runDiscoveryPreview({ workspaceRoot: ctx.workspaceRoot, signal: ctx.commandSignal });
  } catch (error) {
    if (ctx.commandSignal?.aborted) return 'Discovery cancelled.';
    throw error;
  }
}
