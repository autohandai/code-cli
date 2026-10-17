import type { Session } from 'tuistory';

export function programStatusReports(session: Pick<Session, 'getRawOutput'>, after = 0): Array<Record<string, string>> {
  return [...session.getRawOutput().slice(after).matchAll(/\x1b\]7501;([^\x1b\x07]*)(?:\x1b\\|\x07)/g)]
    .map(match => Object.fromEntries(match[1].split(':').map(pair => {
      const separator = pair.indexOf('=');
      return [pair.slice(0, separator), pair.slice(separator + 1)];
    })));
}
