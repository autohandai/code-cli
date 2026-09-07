import type { Session } from 'tuistory';

export async function sampleComposerCaret(session: Session, count = 12): Promise<boolean[]> {
  const samples: boolean[] = [];
  for (let index = 0; index < count; index += 1) {
    await new Promise<void>((resolve) => setTimeout(resolve, 40));
    const deadline = Date.now() + 2_000;
    // A synchronized frame can span PTY chunks; the terminal displays it only after the closing sequence.
    while (true) {
      const output = session.getRawOutput();
      if (output.lastIndexOf('\x1b[?2026h') <= output.lastIndexOf('\x1b[?2026l')) break;
      if (Date.now() >= deadline) throw new Error('The synchronized terminal frame did not finish.');
      await new Promise<void>((resolve) => setTimeout(resolve, 5));
    }
    samples.push(session.getTerminalData().cursorVisible);
  }
  return samples;
}

export function composerCaretLine(session: Session): string {
  const data = session.getTerminalData();
  const [column, row] = data.cursor;
  const line = data.lines.slice(-data.rows)[row]?.spans.map((span) => span.text).join('') ?? '';
  return `${line.slice(0, column)}|${line.slice(column)}`.trimEnd();
}
