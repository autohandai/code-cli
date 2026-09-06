import React from 'react';
import { describe, expect, it } from 'vitest';
import { renderInkScreen } from '../../../src/testing/drivers/ink-driver.js';
import { ImportSummary } from '../../../src/import/ui/ImportWizard.js';

describe('hook import summary', () => {
  it('shows activation instructions and unsupported hook reasons', () => {
    const view = renderInkScreen(<ImportSummary source="Claude Code" result={{ source: 'claude', duration: 1,
      imported: new Map([['hooks', { success: 1, failed: 0, skipped: 1, skipReasons: { 'Stop requires manual porting': 1 } }]]), errors: [] }} />);
    expect(view.lastFrame()).toContain('saved disabled');
    expect(view.lastFrame()).toContain('/hooks manage');
    expect(view.lastFrame()).toContain('Stop requires manual porting');
    view.unmount();
  });
});
