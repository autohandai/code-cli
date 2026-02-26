import { describe, it, expect } from 'vitest';
import type { TeamSettings, AutohandConfig } from '../../src/types.js';

describe('TeamSettings config', () => {
  it('should accept default team settings', () => {
    const settings: TeamSettings = {};
    expect(settings.enabled).toBeUndefined();
    expect(settings.teammateMode).toBeUndefined();
    expect(settings.maxTeammates).toBeUndefined();
  });

  it('should accept full team settings', () => {
    const settings: TeamSettings = {
      enabled: true,
      teammateMode: 'auto',
      maxTeammates: 5,
    };
    expect(settings.enabled).toBe(true);
    expect(settings.teammateMode).toBe('auto');
    expect(settings.maxTeammates).toBe(5);
  });

  it('should accept all teammate modes', () => {
    const modes: TeamSettings['teammateMode'][] = ['auto', 'in-process', 'tmux'];
    for (const mode of modes) {
      const settings: TeamSettings = { teammateMode: mode };
      expect(settings.teammateMode).toBe(mode);
    }
  });

  it('should integrate into AutohandConfig', () => {
    const config: AutohandConfig = {
      teams: {
        enabled: true,
        teammateMode: 'auto',
        maxTeammates: 3,
      },
    };
    expect(config.teams?.enabled).toBe(true);
    expect(config.teams?.maxTeammates).toBe(3);
  });
});
