/** @license Apache-2.0 */
import { InkRenderer } from '../../ui/ink/InkRenderer.js';
import { initTheme } from '../../ui/theme/index.js';

if (!process.env.AUTOHAND_HOME) throw new Error('The full-screen fixture requires an isolated AUTOHAND_HOME');
initTheme('dracula');

const renderer = new InkRenderer({
  fullScreenMode: true,
  onInstruction: () => {},
  onEscape: () => {},
  onCtrlC: () => {
    void renderer.stop().then(() => {
      process.stdout.write('\nFULL_SCREEN_PTY_EXIT\n', () => process.exit(0));
    });
  },
  tipProvider: accept => accept('Type /review to check your changes') ? 'Type /review to check your changes' : undefined,
});
renderer.addUserMessage('Earlier request');
renderer.setFinalResponse(Array.from({ length: 50 }, (_, i) => `fixture-history-${i + 1}`).join('\n'));
renderer.addUserMessage('thanks');
renderer.setWorking(true, 'Running fixture command...');
renderer.setElapsed('0m 16s');
renderer.setTokens('↑40 ↓10');
const commandId = renderer.startLiveCommand('fixture command');
renderer.appendLiveCommandOutput(commandId, 'stdout', Array.from({ length: 60 }, (_, i) => `live-row-${i + 1}`).join('\n'));
renderer.start();
