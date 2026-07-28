/** @fileoverview Formats and emits bounded notifications for pending, completed, and failed user actions. */
import { isDucatSnapError } from './errors';

type ActionNotificationStatus = 'pending' | 'completed' | 'failed';

type ActionNotificationParams = {
  title: string;
  status: ActionNotificationStatus;
  detail?: string;
};

function truncate(value: string, maxLength = 120): string {
  return value.length > maxLength ? `${value.slice(0, maxLength - 1)}...` : value;
}

function notificationMessage(params: ActionNotificationParams): string {
  const prefix =
    params.status === 'pending'
      ? 'Review in MetaMask'
      : params.status === 'completed'
        ? 'Ducat action complete'
        : 'Ducat action failed';
  const detail = params.detail ? ` - ${truncate(params.detail)}` : '';

  return `${prefix}: ${params.title}${detail}`;
}

/**
 * Sends a best-effort post-action notification without affecting the completed operation.
 * @param params - Public action label and outcome metadata.
 * @returns After notification succeeds or its failure is ignored.
 */
export async function notifyAction(params: ActionNotificationParams): Promise<void> {
  try {
    await snap.request({
      method: 'snap_notify',
      params: {
        type: 'inApp',
        message: notificationMessage(params),
      },
    });
  } catch (error) {
    // Notifications are advisory. Never fail signing or transfer flows because MetaMask rejected a notification.
    void (error instanceof Error ? error.message : String(error));
  }
}

/**
 * Sends a best-effort failure notification except for explicit user rejection.
 * @param title - Public action title.
 * @param error - Unknown operation failure.
 * @returns After notification succeeds or its failure is ignored.
 */
export async function notifyActionFailure(title: string, error: unknown): Promise<void> {
  if (isDucatSnapError(error) && error.code === 'USER_REJECTED') {
    return;
  }

  const detail = error instanceof Error ? error.message : String(error);

  await notifyAction({ title, status: 'failed', detail });
}
