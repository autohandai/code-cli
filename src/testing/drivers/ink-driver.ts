import React from 'react';
import { render } from 'ink-testing-library';
import { ThemeProvider } from '../../ui/theme/ThemeContext.js';

export function renderInkScreen(component: React.ReactElement): ReturnType<typeof render> {
  return render(React.createElement(ThemeProvider, null, component));
}
