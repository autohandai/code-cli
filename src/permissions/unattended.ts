export const UNATTENDED_APPROVAL_EXIT_CODE = 77;

export function describeUnattendedApproval(tool: string): string {
  return `${tool} needs approval and this run can't ask: rerun with --yes or --allowed-tools ${tool}.`;
}

export function summarizeUnattendedApprovals(tools: readonly string[]): string {
  return `Run stopped: ${[...new Set(tools)].map(describeUnattendedApproval).join('\n')}`;
}
