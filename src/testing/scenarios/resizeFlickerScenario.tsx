/** @license Apache-2.0 */
import { InkRenderer } from '../../ui/ink/InkRenderer.js';

if (!process.env.AUTOHAND_HOME) throw new Error('The resize fixture requires an isolated AUTOHAND_HOME');

let streamTimer: ReturnType<typeof setInterval> | undefined;
let streamed = 0;
const renderer = new InkRenderer({
  fullScreenMode: process.argv.includes('--full-screen'),
  onInstruction: () => {},
  onEscape: () => {
    clearInterval(streamTimer);
    renderer.setWorking(false);
    renderer.setFinalResponse(`RESIZE_STREAM_COMPLETE ${streamed}`);
  },
  onCtrlC: () => {
    clearInterval(streamTimer);
    void renderer.stop().then(() => {
      process.stdout.write('\nRESIZE_PTY_EXIT\n', () => process.exit(0));
    });
  },
});
renderer.addUserMessage('Resize transcript remains visible');
renderer.setFinalResponse('RESIZE_HISTORY retained text');
if (process.argv.includes('--multiline')) renderer.setInput(`preserved draft\n${'wrapped composer '.repeat(6)}tail`);
if (process.argv.includes('--streaming')) {
  renderer.addUserMessage('Resize active request');
  renderer.setWorking(true, 'Resize streaming fixture');
}
renderer.start();
if (process.argv.includes('--streaming')) {
  streamTimer = setInterval(() => {
    streamed += 1;
    renderer.setStreamingResponse(`RESIZE_STREAM ${streamed} retained streamed text`);
  }, 40);
}
