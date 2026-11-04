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
  return `${tool} needs approval and this run can't ask: rerun with --yes or --allowed-tools ${tool}.`;
}

export function summarizeUnattendedApprovals(tools: readonly string[]): string {
  return `Run stopped: ${[...new Set(tools)].map(describeUnattendedApproval).join('\n')}`;
}
