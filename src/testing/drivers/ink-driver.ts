import React from 'react';
import { render } from 'ink-testing-library';
import { I18nProvider } from '../../ui/i18n/index.js';
import { ThemeProvider } from '../../ui/theme/ThemeContext.js';

export function renderInkScreen(component: React.ReactElement): ReturnType<typeof render> {
  return render(React.createElement(ThemeProvider, null, component));
}

export function launchInk(component: React.ReactElement) {
  const rendered = render(React.createElement(I18nProvider, null,
    React.createElement(ThemeProvider, null, component)));
  const settle = () => new Promise<void>(resolve => setTimeout(resolve, 40));
  return {
    ...rendered,
    async type(text: string) { rendered.stdin.write(text); await settle(); },
    async enter() { rendered.stdin.write('\r'); await settle(); },
    async up() { rendered.stdin.write('\x1b[A'); await settle(); },
    async down() { rendered.stdin.write('\x1b[B'); await settle(); },
    async ctrlC() { rendered.stdin.write('\x03'); await settle(); },
    async tab() { rendered.stdin.write('\t'); await settle(); },
    async escape() { rendered.stdin.write('\x1b'); await settle(); },
    snapshot: () => rendered.lastFrame() ?? '',
    settle,
  };
}
