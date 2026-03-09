/**
 * @license
 * Copyright 2025 Autohand AI LLC
 * SPDX-License-Identifier: Apache-2.0
 *
 * Tests for skill telemetry tracking integration
 * Verifies that skill_use events are emitted at key lifecycle points:
 * - SkillsRegistry.activateSkill() → action: 'activate'
 * - /learn install → action: 'install'
 * - /learn remove → action: 'remove'
 * - /learn update → action: 'update'
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { SkillUseData } from '../../src/telemetry/types.js';
import type { SkillDefinition } from '../../src/skills/types.js';

// ─── TelemetryManager mock ──────────────────────────────────────────

function createMockTelemetryManager() {
  return {
    trackSkillUse: vi.fn().mockResolvedValue(undefined),
    startSession: vi.fn(),
    endSession: vi.fn(),
    trackToolUse: vi.fn(),
    trackError: vi.fn(),
    trackCommand: vi.fn(),
    trackModelSwitch: vi.fn(),
    trackHeartbeat: vi.fn(),
    recordInteraction: vi.fn(),
    syncSession: vi.fn(),
    getSessionId: vi.fn(),
    getDeviceId: vi.fn(),
    getStats: vi.fn(),
    flush: vi.fn(),
    disable: vi.fn(),
    enable: vi.fn(),
    shutdown: vi.fn(),
    trackSessionFailureBug: vi.fn(),
  };
}

// ─── SkillUseData type tests ────────────────────────────────────────

describe('SkillUseData type', () => {
  it('accepts action field for activate', () => {
    const data: SkillUseData = {
      skillName: 'test-skill',
      source: 'autohand-user',
      activationType: 'explicit',
      action: 'activate',
    };
    expect(data.action).toBe('activate');
  });

  it('accepts action field for install', () => {
    const data: SkillUseData = {
      skillName: 'community-skill',
      source: 'community',
      activationType: 'explicit',
      action: 'install',
    };
    expect(data.action).toBe('install');
  });

  it('accepts action field for remove', () => {
    const data: SkillUseData = {
      skillName: 'old-skill',
      source: 'community',
      activationType: 'explicit',
      action: 'remove',
    };
    expect(data.action).toBe('remove');
  });

  it('accepts action field for update', () => {
    const data: SkillUseData = {
      skillName: 'updated-skill',
      source: 'community',
      activationType: 'explicit',
      action: 'update',
    };
    expect(data.action).toBe('update');
  });

  it('allows action to be omitted (backward compat)', () => {
    const data: SkillUseData = {
      skillName: 'legacy-skill',
      source: 'autohand-user',
      activationType: 'auto',
    };
    expect(data.action).toBeUndefined();
  });
});

// ─── SkillsRegistry.activateSkill tracking ──────────────────────────

describe('SkillsRegistry skill tracking', () => {
  let registry: Awaited<ReturnType<typeof createTestRegistry>>;
  let mockTelemetry: ReturnType<typeof createMockTelemetryManager>;

  async function createTestRegistry() {
    const { SkillsRegistry } = await import('../../src/skills/SkillsRegistry.js');
    const reg = new SkillsRegistry('/tmp/test-skills');
    return reg;
  }

  beforeEach(async () => {
    registry = await createTestRegistry();
    mockTelemetry = createMockTelemetryManager();
    registry.setTelemetryManager(mockTelemetry as any);

    // Manually register a test skill
    const testSkill: SkillDefinition = {
      name: 'test-skill',
      description: 'A test skill',
      body: '# Test',
      path: '/tmp/test-skills/test-skill/SKILL.md',
      source: 'autohand-user',
      isActive: false,
    };
    (registry as any).skills.set('test-skill', testSkill);
  });

  it('calls trackSkillUse when activating a skill', () => {
    registry.activateSkill('test-skill');

    expect(mockTelemetry.trackSkillUse).toHaveBeenCalledOnce();
    expect(mockTelemetry.trackSkillUse).toHaveBeenCalledWith({
      skillName: 'test-skill',
      source: 'autohand-user',
      activationType: 'explicit',
      action: 'activate',
    });
  });

  it('does not call trackSkillUse when skill not found', () => {
    registry.activateSkill('nonexistent-skill');

    expect(mockTelemetry.trackSkillUse).not.toHaveBeenCalled();
  });

  it('does not throw when telemetryManager is not set', async () => {
    const { SkillsRegistry } = await import('../../src/skills/SkillsRegistry.js');
    const reg = new SkillsRegistry('/tmp/test-skills');
    const testSkill: SkillDefinition = {
      name: 'no-telemetry',
      description: 'No telemetry',
      body: '# Test',
      path: '/tmp/test/SKILL.md',
      source: 'autohand-user',
      isActive: false,
    };
    (reg as any).skills.set('no-telemetry', testSkill);

    // Should not throw even without telemetry manager
    expect(() => reg.activateSkill('no-telemetry')).not.toThrow();
  });

  it('exposes trackSkillEvent for external callers', () => {
    registry.trackSkillEvent({
      skillName: 'external-call',
      source: 'community',
      activationType: 'explicit',
      action: 'install',
    });

    expect(mockTelemetry.trackSkillUse).toHaveBeenCalledWith({
      skillName: 'external-call',
      source: 'community',
      activationType: 'explicit',
      action: 'install',
    });
  });

  it('trackSkillEvent does not throw without telemetry manager', async () => {
    const { SkillsRegistry } = await import('../../src/skills/SkillsRegistry.js');
    const reg = new SkillsRegistry('/tmp/test-skills');

    // Should not throw
    expect(() => reg.trackSkillEvent({
      skillName: 'no-tm',
      source: 'community',
      activationType: 'explicit',
      action: 'install',
    })).not.toThrow();
  });
});

// ─── TelemetryManager.trackSkillUse passes action ───────────────────

describe('TelemetryManager.trackSkillUse', () => {
  it('passes action field in eventData', async () => {
    const { TelemetryManager } = await import('../../src/telemetry/TelemetryManager.js');
    const tm = new TelemetryManager({ enabled: false });

    // Spy on the private trackEvent via the client
    const trackEventSpy = vi.spyOn(tm as any, 'trackEvent').mockResolvedValue(undefined);

    await tm.trackSkillUse({
      skillName: 'my-skill',
      source: 'community',
      activationType: 'explicit',
      action: 'install',
    });

    expect(trackEventSpy).toHaveBeenCalledWith('skill_use', {
      skillName: 'my-skill',
      source: 'community',
      activationType: 'explicit',
      action: 'install',
    });
  });

  it('passes undefined action when not provided', async () => {
    const { TelemetryManager } = await import('../../src/telemetry/TelemetryManager.js');
    const tm = new TelemetryManager({ enabled: false });

    const trackEventSpy = vi.spyOn(tm as any, 'trackEvent').mockResolvedValue(undefined);

    await tm.trackSkillUse({
      skillName: 'legacy-skill',
      source: 'autohand-user',
      activationType: 'auto',
    });

    expect(trackEventSpy).toHaveBeenCalledWith('skill_use', {
      skillName: 'legacy-skill',
      source: 'autohand-user',
      activationType: 'auto',
      action: undefined,
    });
  });
});
