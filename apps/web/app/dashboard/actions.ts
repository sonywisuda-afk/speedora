'use server';

import type { PendingInviteDto, PendingInviteRole } from '@speedora/shared';
import { revalidatePath } from 'next/cache';
import { postServerTeamInvite } from '@/lib/api.server';

// Product Experience performance pass - the one Server Action introduced in
// this pass (see the plan's scoping note: delete/publish/schedule keep their
// existing carefully-tuned optimistic client mutations rather than being
// redone here). revalidatePath means the Activity Timeline picks up the new
// invite on next render instead of waiting for DashboardSummaryClient's own
// 10s poll.
export async function inviteMemberAction(
  email: string,
  role: PendingInviteRole,
): Promise<PendingInviteDto> {
  const invite = await postServerTeamInvite(email, role);
  revalidatePath('/dashboard');
  return invite;
}
