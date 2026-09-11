/**
 * @license
 * Copyright 2026 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it, vi } from 'vitest';
import { createTeamMemberProvider, resolveTeamModelAssignment } from '../../../src/core/teams/TeamModelPolicy.js';
import { ProviderFactory } from '../../../src/providers/ProviderFactory.js';
import type { AutohandConfig } from '../../../src/types.js';

describe('resolveTeamModelAssignment', () => {
  const config: AutohandConfig = {
    provider: 'openrouter',
    openrouter: { apiKey: 'test-key', model: 'openrouter/auto' },
    autohandai: { plan: 'cloud', model: 'fantail' },
  };

  it('runs Autohand AI members on the fast tier when nothing overrides it', () => {
    expect(resolveTeamModelAssignment({
      config,
      active: { provider: 'autohandai', model: 'fantail' },
    })).toEqual({
      provider: 'autohandai',
      model: 'fantail',
      source: 'agent-nature',
    });
  });

  it('inherits the active session on providers without a fast tier', () => {
    expect(resolveTeamModelAssignment({
      config,
      active: { provider: 'openrouter', model: 'openrouter/auto' },
      environment: {},
    })).toEqual({ provider: 'openrouter', model: 'openrouter/auto', source: 'active-session' });
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

  it('drops catalogue metadata naming another provider model and runs the member on the fast tier', () => {
    expect(resolveTeamModelAssignment({
      config,
      active: { provider: 'autohandai', model: 'moa' },
      agentModel: 'gpt-5.4',
      environment: {},
    })).toEqual({ provider: 'autohandai', model: 'fantail', source: 'agent-nature' });
  });

  it('defaults Autohand AI members to fantail and gives reasoning-natured agents moa with their effort', () => {
    expect(resolveTeamModelAssignment({
      config,
      active: { provider: 'autohandai', model: 'moa' },
      agentName: 'implementer',
      environment: {},
    })).toEqual({ provider: 'autohandai', model: 'fantail', source: 'agent-nature' });
    expect(resolveTeamModelAssignment({
      config,
      active: { provider: 'autohandai', model: 'fantail' },
      agentName: 'reviewer',
      agentReasoning: 'high',
      environment: {},
    })).toEqual({ provider: 'autohandai', model: 'moa', source: 'agent-nature', reasoningEffort: 'high' });
    expect(resolveTeamModelAssignment({
      config,
      active: { provider: 'autohandai', model: 'moa' },
      agentReasoning: 'none',
      environment: {},
    })).toEqual({ provider: 'autohandai', model: 'fantail', source: 'agent-nature' });
  });

  it('ignores a tool-supplied model the Autohand AI catalogue does not know', () => {
    expect(resolveTeamModelAssignment({
      config,
      active: { provider: 'autohandai', model: 'moa' },
      override: { model: 'gpt-5.4' },
      agentReasoning: 'high',
      environment: {},
    })).toEqual({ provider: 'autohandai', model: 'moa', source: 'agent-nature', reasoningEffort: 'high' });
    expect(resolveTeamModelAssignment({
      config,
      active: { provider: 'autohandai', model: 'fantail' },
      override: { model: 'moa' },
      environment: {},
    })).toEqual({ provider: 'autohandai', model: 'moa', source: 'member-override' });
  });

  it('keeps user-level defaults ahead of the fast-tier rule', () => {
    expect(resolveTeamModelAssignment({
      config: { ...config, teams: { defaultProvider: 'autohandai', defaultModel: 'moa' } },
      active: { provider: 'autohandai', model: 'fantail' },
      environment: {},
    })).toEqual({ provider: 'autohandai', model: 'moa', source: 'team-default' });
    expect(resolveTeamModelAssignment({
      config,
      active: { provider: 'autohandai', model: 'fantail' },
      environment: { SUB_AGENTS_MODEL: 'moa' },
    })).toEqual({ provider: 'autohandai', model: 'moa', source: 'environment' });
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
      agentModel: 'anthropic/claude-sonnet-5',
      environment: {},
    })).toEqual({ provider: 'openrouter', model: 'anthropic/claude-sonnet-5', source: 'agent-definition' });
  });

  it('keeps the user\'s model on other providers when a definition names a model their catalogue lacks', () => {
    expect(resolveTeamModelAssignment({
      config,
      active: { provider: 'openrouter', model: 'openrouter/auto' },
      agentModel: 'gpt-5.4',
      agentReasoning: 'high',
      environment: {},
    })).toEqual({ provider: 'openrouter', model: 'openrouter/auto', source: 'active-session' });
    expect(resolveTeamModelAssignment({
      config: { ...config, provider: 'anthropic', anthropic: { apiKey: 'k', model: 'claude-sonnet-5' } },
      active: { provider: 'anthropic', model: 'claude-sonnet-5' },
      agentModel: 'gpt-5.4',
      environment: {},
    })).toEqual({ provider: 'anthropic', model: 'claude-sonnet-5', source: 'active-session' });
  });
});

describe('createTeamMemberProvider', () => {
  const config: AutohandConfig = {
    provider: 'autohandai',
    autohandai: { plan: 'cloud', authMode: 'api-key', apiKey: 'k', model: 'moa', reasoningEffort: 'xhigh' },
  };

  it('builds the member provider with the assignment reasoning effort and model', () => {
    const setModel = vi.fn();
    const create = vi.spyOn(ProviderFactory, 'create').mockReturnValue({ setModel } as never);
    createTeamMemberProvider(config, {
      provider: 'autohandai', model: 'moa', source: 'agent-nature', reasoningEffort: 'high',
    });

    expect(create).toHaveBeenCalledWith(expect.objectContaining({
      provider: 'autohandai',
      autohandai: expect.objectContaining({ reasoningEffort: 'high' }),
    }));
    expect(setModel).toHaveBeenCalledWith('moa');
    create.mockRestore();
  });

  it('leaves the lead session reasoning effort in place when the assignment carries none', () => {
    const create = vi.spyOn(ProviderFactory, 'create').mockReturnValue({ setModel: vi.fn() } as never);
    createTeamMemberProvider(config, { provider: 'autohandai', model: 'fantail', source: 'agent-nature' });

    expect(create).toHaveBeenCalledWith(expect.objectContaining({
      autohandai: expect.objectContaining({ reasoningEffort: 'xhigh' }),
    }));
    create.mockRestore();
  });
});
