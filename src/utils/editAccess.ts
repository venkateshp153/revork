import { sendAlert } from './notifications';

/**
 * Safety notification for non-admin edits. The admin is alerted, while the
 * granted edit access stays active until the admin revokes it.
 *
 * Reused by both the profile screen and worker-details screen.
 */
export async function notifyAdminOfEdit(params: {
  sheetId: string;
  token: string | null;
  actorWorkerId?: string | null;
  actorName?: string | null;
  targetName?: string | null;
  action: string;
}): Promise<void> {
  const actorWorkerId = (params.actorWorkerId || '').trim();
  if (!params.sheetId || !actorWorkerId) return;

  try {
    await sendAlert({
      sheetId: params.sheetId,
      token: params.token,
      target: 'admin',
      title: 'Data updated',
      body: `${params.actorName || 'A teammate'} ${params.action}${
        params.targetName ? ` for ${params.targetName}` : ''
      }.`,
      durationHours: 0,
      fromUid: actorWorkerId,
    });
  } catch (error) {
    console.warn('Could not notify admin of the edit:', error);
  }
}
