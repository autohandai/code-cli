import React from 'react';
import { render } from 'ink';
import {
  DiscoveryProgress,
  type DiscoveryProgressEvent,
} from './DiscoveryProgress.js';

export function createDiscoveryProgress(options: {
  json: boolean;
  analyze: boolean;
  cancel: () => void;
}) {
  const events: DiscoveryProgressEvent[] = [];
  const terminal = process.stderr.isTTY && process.stdin.isTTY && !options.json;
  const instance = terminal
    ? render(
        <DiscoveryProgress
          events={events}
          onCancel={options.cancel}
          analyze={options.analyze}
        />,
        { stdout: process.stderr, exitOnCtrlC: false }
      )
    : undefined;
  let lastStage: string | undefined;
  let finished = false;
  return {
    update(event: DiscoveryProgressEvent) {
      if (finished) return;
      if (events.at(-1)?.stage === event.stage)
        events[events.length - 1] = event;
      else events.push(event);
      if (instance)
        instance.rerender(
          <DiscoveryProgress
            events={[...events]}
            onCancel={options.cancel}
            analyze={options.analyze}
          />
        );
      else if (!options.json && lastStage !== event.stage)
        process.stderr.write(
          `  ${event.detail.replace(/[\x00-\x1f\x7f-\x9f]/g, ' ').slice(0, 180)}\n`
        );
      lastStage = event.stage;
    },
    finish() {
      if (finished) return;
      finished = true;
      instance?.clear();
      instance?.unmount();
    },
  };
}
