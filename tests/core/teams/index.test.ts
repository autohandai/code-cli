import { describe, it, expect } from 'vitest';

describe('teams barrel export', () => {
  it('should export all team modules', async () => {
    const teams = await import('../../../src/core/teams/index.js');
    expect(teams.TeamManager).toBeDefined();
    expect(teams.TaskManager).toBeDefined();
    expect(teams.TeammateProcess).toBeDefined();
    expect(teams.MessageRouter).toBeDefined();
    expect(teams.ProjectProfiler).toBeDefined();
    // Type exports (schemas)
    expect(teams.TeamSchema).toBeDefined();
    expect(teams.TeamTaskSchema).toBeDefined();
    expect(teams.TeamMemberSchema).toBeDefined();
    expect(teams.ProjectProfileSchema).toBeDefined();
  });
});
