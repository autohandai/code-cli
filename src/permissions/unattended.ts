export const UNATTENDED_APPROVAL_EXIT_CODE = 77;

export function describeUnattendedApproval(tool: string): string {
  return `${tool} needs approval, and this run can't ask for it. Rerun with --yes, or with --allowed-tools ${tool}.`;
}

export function summarizeUnattendedApprovals(tools: readonly string[]): string {
  const denied = [...new Set(tools)];
  return `Denied (this run can't ask for approval): ${denied.join(', ')}. Rerun with --yes, or with --allowed-tools ${denied.join(',')}.`;
}
