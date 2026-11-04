import { describe, expect, it } from 'vitest';
import { describeUnattendedApproval, summarizeUnattendedApprovals } from '../../src/permissions/unattended.js';

describe('approved unattended approval diagnostics', () => {
  it('uses the real tool name in the two-sentence denial', () => {
    expect(describeUnattendedApproval('write_file')).toBe("write_file needs approval, and this run can't ask for it. Rerun with --yes, or with --allowed-tools write_file.");
  });
  it('lists every denied tool once in one stderr summary line', () => {
    const summary = summarizeUnattendedApprovals(['write_file', 'run_command', 'write_file']);
    expect(summary).toBe("Denied (this run can't ask for approval): write_file, run_command. Rerun with --yes, or with --allowed-tools write_file,run_command.");
    expect(summary.split('\n')).toHaveLength(1);
  });
});
