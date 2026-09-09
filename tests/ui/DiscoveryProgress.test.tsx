import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { renderInkScreen } from '../../src/testing/drivers/ink-driver.js';
import { DiscoveryProgress } from '../../src/discovery/DiscoveryProgress.js';

describe('discovery progress', () => {
  it('shows completed work, the current operation and the next stages without a framed card', () => {
    const view = renderInkScreen(
      <DiscoveryProgress
        events={[
          { stage: 'repositories', detail: 'Found 2 repositories' },
          { stage: 'skills', detail: 'Finding SKILL.md files' },
        ]}
        onCancel={() => {}}
      />
    );
    expect(view.lastFrame()).toMatchInlineSnapshot(`
      "
        Discover useful workflows
        Your repositories, skills and recurring work

        ✓  Repositories
        ›  Skills
           Finding SKILL.md files
        ·  User requests
        ·  Engineering activity
        ·  Recommendations
        ·  Local drafts

        Ctrl+C to cancel
      "
    `);
    view.unmount();
  });

  it('handles Ctrl+C through the cancellation owner', async () => {
    const cancel = vi.fn();
    const view = renderInkScreen(
      <DiscoveryProgress
        events={[{ stage: 'upload', detail: 'Uploading selected drafts' }]}
        onCancel={cancel}
      />
    );
    await new Promise((resolve) => setTimeout(resolve, 20));
    view.stdin.write('\u0003');
    expect(cancel).toHaveBeenCalledOnce();
    view.unmount();
  });
});
