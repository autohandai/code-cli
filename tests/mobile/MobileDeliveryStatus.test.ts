/**
 * @license
 * Copyright 2026 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */
import { describe, expect, it } from 'vitest';
import {
  collectMobileDeliveryStatus,
  mergeMobilePullRequest,
  type MobileGitHubCommandRunner,
} from '../../src/mobile/MobileDeliveryStatus.js';

describe('collectMobileDeliveryStatus', () => {
  it('maps the current GitHub pull request, checks, and deployments', async () => {
    const runner: MobileGitHubCommandRunner = async (args) => {
      const command = args.join(' ');
      if (command.startsWith('pr view')) {
        return JSON.stringify({
          number: 42,
          title: 'Ship mobile delivery state',
          url: 'https://github.com/autohandai/code-cli/pull/42',
          headRefName: 'mobile-delivery',
          baseRefName: 'main',
          state: 'OPEN',
          mergeable: 'MERGEABLE',
          additions: 80,
          deletions: 12,
          changedFiles: 4,
          updatedAt: '2026-07-13T10:00:00Z',
          statusCheckRollup: [{
            databaseId: 7,
            name: 'Build',
            status: 'COMPLETED',
            conclusion: 'SUCCESS',
            detailsUrl: 'https://github.com/autohandai/code-cli/actions/runs/7',
          }],
        });
      }
      if (command === 'repo view --json nameWithOwner') {
        return JSON.stringify({ nameWithOwner: 'autohandai/code-cli' });
      }
      if (command.includes('/deployments?')) {
        return JSON.stringify([{
          id: 88,
          environment: 'Preview',
          description: 'Mobile preview',
          updated_at: '2026-07-13T10:01:00Z',
        }]);
      }
      if (command.includes('/deployments/88/statuses')) {
        return JSON.stringify([{
          state: 'success',
          description: 'Ready',
          environment_url: 'https://preview.example.com/42',
          log_url: 'https://github.com/autohandai/code-cli/actions/runs/8',
          updated_at: '2026-07-13T10:02:00Z',
        }]);
      }
      throw new Error(`Unexpected gh command: ${command}`);
    };

    const snapshot = await collectMobileDeliveryStatus('/workspace', runner);

    expect(snapshot.pullRequest).toMatchObject({
      id: '42',
      status: 'open',
      mergeable: true,
      checks: [{ id: '7', name: 'Build', status: 'passed' }],
    });
    expect(snapshot.deployments).toEqual([
      expect.objectContaining({
        id: '88',
        name: 'Preview',
        status: 'success',
        previewURL: 'https://preview.example.com/42',
      }),
    ]);
  });

  it('returns an empty snapshot when GitHub metadata is unavailable', async () => {
    const unavailable: MobileGitHubCommandRunner = async () => {
      throw new Error('gh is not authenticated');
    };

    await expect(collectMobileDeliveryStatus('/workspace', unavailable)).resolves.toEqual({
      pullRequest: null,
      deployments: [],
    });
  });

  it('rechecks reviewed PR state before issuing a fixed squash merge command', async () => {
    const commands: string[] = [];
    const runner: MobileGitHubCommandRunner = async (args) => {
      const command = args.join(' ');
      commands.push(command);
      if (command.startsWith('pr view')) {
        return JSON.stringify({
          number: 42,
          title: 'Ship mobile merge',
          url: 'https://github.com/autohandai/code-cli/pull/42',
          headRefName: 'mobile-merge',
          baseRefName: 'main',
          state: 'OPEN',
          mergeable: 'MERGEABLE',
          additions: 10,
          deletions: 2,
          changedFiles: 1,
          statusCheckRollup: [{ name: 'Build', conclusion: 'SUCCESS' }],
        });
      }
      if (command === 'pr merge 42 --squash') return '';
      throw new Error(`Unexpected gh command: ${command}`);
    };

    await expect(mergeMobilePullRequest('/workspace', {
      pullRequestNumber: 42,
      expectedHeadBranch: 'mobile-merge',
      method: 'squash',
    }, runner)).resolves.toMatchObject({ status: 'merged', pullRequestNumber: 42 });
    expect(commands).toEqual([
      expect.stringMatching(/^pr view /),
      'pr merge 42 --squash',
    ]);
  });

  it('rejects a merge when the reviewed head branch is stale', async () => {
    const commands: string[] = [];
    const runner: MobileGitHubCommandRunner = async (args) => {
      commands.push(args.join(' '));
      return JSON.stringify({
        number: 42,
        title: 'Changed PR',
        url: 'https://github.com/autohandai/code-cli/pull/42',
        headRefName: 'different-branch',
        baseRefName: 'main',
        state: 'OPEN',
        mergeable: 'MERGEABLE',
        additions: 1,
        deletions: 0,
        changedFiles: 1,
        statusCheckRollup: [{ name: 'Build', conclusion: 'SUCCESS' }],
      });
    };

    await expect(mergeMobilePullRequest('/workspace', {
      pullRequestNumber: 42,
      expectedHeadBranch: 'reviewed-branch',
      method: 'squash',
    }, runner)).resolves.toMatchObject({ status: 'rejected' });
    expect(commands).toHaveLength(1);
  });
});
