import { useSyncExternalStore } from 'react';
import { useStdout } from 'ink';

interface TerminalWindowSize {
  columns: number | undefined;
  rows: number | undefined;
}

type TerminalStream = ReturnType<typeof useStdout>['stdout'];

interface TerminalSizeStore {
  getSnapshot(): TerminalWindowSize;
  subscribe(listener: () => void): () => void;
}

const stores = new WeakMap<TerminalStream, TerminalSizeStore>();

function terminalSizeStore(stdout: TerminalStream): TerminalSizeStore {
  const existing = stores.get(stdout);
  if (existing) return existing;

  let snapshot: TerminalWindowSize = { columns: stdout.columns, rows: stdout.rows };
  const listeners = new Set<() => void>();
  const getSnapshot = () => {
    if (snapshot.columns !== stdout.columns || snapshot.rows !== stdout.rows) {
      snapshot = { columns: stdout.columns, rows: stdout.rows };
    }
    return snapshot;
  };
  const onResize = () => {
    getSnapshot();
    for (const listener of [...listeners]) listener();
  };
  const store: TerminalSizeStore = {
    getSnapshot,
    subscribe(listener) {
      listeners.add(listener);
      if (listeners.size === 1) stdout.on('resize', onResize);
      return () => {
        listeners.delete(listener);
        if (listeners.size === 0) stdout.off('resize', onResize);
      };
    },
  };
  stores.set(stdout, store);
  return store;
}

export function useTerminalWindowSize(): TerminalWindowSize {
  const { stdout } = useStdout();
  const store = terminalSizeStore(stdout);
  return useSyncExternalStore(store.subscribe, store.getSnapshot);
}
