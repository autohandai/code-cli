/**
 * @license
 * Copyright 2026 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'vitest';
import { resolveTeamModelAssignment } from '../../../src/core/teams/TeamModelPolicy.js';
import type { AutohandConfig } from '../../../src/types.js';

describe('resolveTeamModelAssignment', () => {
  const config: AutohandConfig = {
    provider: 'openrouter',
    openrouter: { apiKey: 'test-key', model: 'openrouter/auto' },
    autohandai: { plan: 'cloud', model: 'fantail' },
  };

  it('inherits the active Autohand AI assignment when no team default is configured', () => {
    expect(resolveTeamModelAssignment({
      config,
      active: { provider: 'autohandai', model: 'fantail' },
    })).toEqual({
      provider: 'autohandai',
      model: 'fantail',
      source: 'active-session',
    });
  });

  it('uses a saved team default without falling back to OpenRouter', () => {
    expect(resolveTeamModelAssignment({
      config: {
        ...config,
        teams: { defaultProvider: 'autohandai', defaultModel: 'fantail' },
      },
      active: { provider: 'openrouter', model: 'openrouter/auto' },
    })).toEqual({
      provider: 'autohandai',
      model: 'fantail',
      source: 'team-default',
    });
  });

  it('accepts SUB_AGENTS_MODEL and SUB_AGENTS_PROVIDER as session-scoped defaults', () => {
    expect(resolveTeamModelAssignment({
      config,
      active: { provider: 'openrouter', model: 'openrouter/auto' },
      environment: {
        SUB_AGENTS_PROVIDER: 'autohandai',
        SUB_AGENTS_MODEL: 'fantail',
      },
    })).toEqual({
      provider: 'autohandai',
      model: 'fantail',
      source: 'environment',
    });
  });

  it('keeps a per-member choice ahead of every default', () => {
    expect(resolveTeamModelAssignment({
      config: {
        ...config,
        teams: { defaultProvider: 'autohandai', defaultModel: 'fantail' },
      },
      active: { provider: 'autohandai', model: 'fantail' },
      environment: {
        SUB_AGENTS_PROVIDER: 'openrouter',
        SUB_AGENTS_MODEL: 'openrouter/auto',
      },
      override: { provider: 'anthropic', model: 'claude-sonnet-5' },
    })).toEqual({
      provider: 'anthropic',
      model: 'claude-sonnet-5',
      source: 'member-override',
    });
  });

  it('uses a saved per-agent assignment ahead of the team default', () => {
    expect(resolveTeamModelAssignment({
      config: {
        ...config,
        teams: {
          defaultProvider: 'autohandai',
          defaultModel: 'fantail',
          agentModelOverrides: {
            reviewer: { provider: 'anthropic', model: 'claude-sonnet-5' },
          },
        },
      },
      active: { provider: 'openrouter', model: 'openrouter/auto' },
      agentName: 'reviewer',
    })).toEqual({
      provider: 'anthropic',
      model: 'claude-sonnet-5',
      source: 'agent-override',
    });
  });

  it('inherits the active cloud model when catalogue metadata names another provider model', () => {
    expect(resolveTeamModelAssignment({
      config,
      active: { provider: 'autohandai', model: 'moa' },
      agentModel: 'gpt-5.4',
      environment: {},
    })).toEqual({ provider: 'autohandai', model: 'moa', source: 'active-session' });
  });

  it('preserves compatible catalogue models and explicit provider assignments', () => {
    expect(resolveTeamModelAssignment({
      config,
      active: { provider: 'autohandai', model: 'moa' },
      agentModel: 'fantail',
      environment: {},
    })).toEqual({ provider: 'autohandai', model: 'fantail', source: 'agent-definition' });
    expect(resolveTeamModelAssignment({
      config,
      active: { provider: 'autohandai', model: 'moa' },
      agentModel: 'gpt-5.4',
      override: { provider: 'openai', model: 'gpt-5.4' },
      environment: {},
    })).toEqual({ provider: 'openai', model: 'gpt-5.4', source: 'member-override' });
  });

  it('preserves arbitrary local and other-provider catalogue models', () => {
    expect(resolveTeamModelAssignment({
      config: { ...config, autohandai: { plan: 'local', model: 'local-model' } },
      active: { provider: 'autohandai', model: 'local-model' },
      agentModel: 'custom-local-model',
      environment: {},
    })).toEqual({ provider: 'autohandai', model: 'custom-local-model', source: 'agent-definition' });
    expect(resolveTeamModelAssignment({
      config,
      active: { provider: 'openrouter', model: 'openrouter/auto' },
      agentModel: 'openai/gpt-5.4',
      environment: {},
    })).toEqual({ provider: 'openrouter', model: 'openai/gpt-5.4', source: 'agent-definition' });
  });
});
