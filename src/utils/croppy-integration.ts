import type { ApprovalInput } from './croppy-approval';
export async function checkPhaseApproval(input: ApprovalInput): Promise<{ approved: boolean; reason: string }> {
  return { approved: false, reason: 'stub - manual approval required' };
}
