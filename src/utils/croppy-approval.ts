export interface ApprovalInput {
  phase: string;
  changes: string[];
  testsPassed: boolean;
  hasErrors: boolean;
}
export interface ApprovalResult {
  approved: boolean;
  reason: string;
}
export async function checkCroppyApproval(input: ApprovalInput): Promise<ApprovalResult> {
  return { approved: false, reason: 'stub - manual approval required' };
}
