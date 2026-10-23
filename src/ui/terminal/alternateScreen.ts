/** @license Apache-2.0 */
interface ScreenOutput { write: (text: string) => unknown }
interface Ownership { count: number; restore: () => void }
const owners = new WeakMap<ScreenOutput, Ownership>();

export function shouldUseFullScreen(enabled: boolean | undefined, stdinTTY: boolean | undefined, stdoutTTY: boolean | undefined, term: string | undefined): boolean {
  return enabled !== false && stdinTTY === true && stdoutTTY === true && term !== 'dumb';
}

export function ownsAlternateScreen(output: ScreenOutput): boolean {
  return owners.has(output);
}

export function acquireAlternateScreen(output: ScreenOutput): () => void {
  let owner = owners.get(output);
  if (!owner) {
    const restore = () => {
      if (!owners.has(output)) return;
      owners.delete(output);
      process.off('exit', restore);
      output.write('\x1b[?1049l');
    };
    owner = { count: 0, restore };
    output.write('\x1b[?1049h\x1b[2J\x1b[H');
    owners.set(output, owner);
    process.once('exit', restore);
  } else output.write('\x1b[2J\x1b[H');
  owner.count++;
  const current = owner;
  let released = false;
  return () => {
    if (released) return;
    released = true;
    current.count--;
    if (current.count === 0) current.restore();
    else output.write('\x1b[2J\x1b[H');
  };
}
