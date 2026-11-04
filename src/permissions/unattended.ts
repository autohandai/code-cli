export const UNATTENDED_APPROVAL_EXIT_CODE = 77;

export class UnattendedApprovalError extends Error {
  constructor(readonly tools: readonly string[]) {
    super(summarizeUnattendedApprovals(tools));
    this.name = 'UnattendedApprovalError';
  }
}

export class UnattendedApprovalTracker {
  private readonly denied = new Set<string>();

  get hasDenials(): boolean { return this.denied.size > 0; }
  get tools(): string[] { return [...this.denied]; }
  record(tool: string): void { if (this.denied.size < 128) this.denied.add(tool); }
  reset(): void { this.denied.clear(); }
}

export function describeUnattendedApproval(tool: string): string {
  return `${tool} needs approval, and this run can't ask for it. Rerun with --yes, or with --allowed-tools ${tool}.`;
}

export function summarizeUnattendedApprovals(tools: readonly string[]): string {
  const denied = [...new Set(tools)];
  return `Denied (this run can't ask for approval): ${denied.join(', ')}. Rerun with --yes, or with --allowed-tools ${denied.join(',')}.`;
}
