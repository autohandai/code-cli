/** @license Apache-2.0 */
import { format } from 'node:util';

const METHODS = ['log', 'info', 'warn', 'error', 'debug'] as const;
type ConsoleMethod = (typeof METHODS)[number];

/**
 * A full-screen frame owns every row of the terminal. Ink prints console output above its frame,
 * which is right for a scrollback transcript and wrong here: one blank `console.log()` paints the
 * whole frame a row lower until the next repaint. While the frame is mounted the console is held
 * and its text goes to the owner instead of the terminal.
 *
 * Returns a release function. It restores only the methods still held, so a replacement installed
 * later by someone else is left alone.
 */
export function holdConsoleOutput(onText: (text: string) => void): () => void {
  const held = new Map<ConsoleMethod, { original: Console[ConsoleMethod]; replacement: Console[ConsoleMethod] }>();
  for (const method of METHODS) {
    const replacement = (...values: unknown[]): void => {
      try {
        onText(format(...values));
      } catch {
        // Diagnostics must never break the code that logged them.
      }
    };
    held.set(method, { original: console[method], replacement });
    console[method] = replacement;
  }

  return () => {
    for (const [method, { original, replacement }] of held) {
      if (console[method] === replacement) console[method] = original;
    }
    held.clear();
  };
}
