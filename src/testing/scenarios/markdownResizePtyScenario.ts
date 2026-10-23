import { InkRenderer } from '../../ui/ink/InkRenderer.js';

const baseline = process.stdout.listenerCount('resize');
let peak = baseline;
const trackListener = (event: string | symbol) => {
  if (event === 'resize') peak = Math.max(peak, process.stdout.listenerCount('resize') + 1);
};
process.stdout.on('newListener', trackListener);

let finish: () => void = () => {};
const stopped = new Promise<void>(resolve => { finish = resolve; });
const renderer = new InkRenderer({
  loadAxoEnabled: () => false,
  saveAxoEnabled: () => {},
  onInstruction: text => renderer.addNotification(`SUBMITTED: ${text}`),
  onEscape: () => {},
  onCtrlC: finish,
});
try {
  renderer.setChatMessages(Array.from({ length: 32 }, (_, index) => ({
    role: 'assistant', content: `**RESTORED_ANSWER_${index}**`,
  })));
  renderer.start();
  await stopped;
} finally {
  await renderer.stop();
  process.stdout.off('newListener', trackListener);
  process.stdout.write(`\nRESIZE_RESULT ${JSON.stringify({ baseline, peak, afterStop: process.stdout.listenerCount('resize') })}\n`);
}
