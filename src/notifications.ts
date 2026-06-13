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

export async function notifyAction(params: ActionNotificationParams): Promise<void> {
  try {
    await snap.request({
      method: 'snap_notify',
      params: {
        type: 'inApp',
        message: notificationMessage(params),
      },
    });
  } catch {
    // Notifications are advisory. Never fail signing or transfer flows because MetaMask rejected a notification.
  }
}

export async function notifyActionFailure(title: string, error: unknown): Promise<void> {
  if (isDucatSnapError(error) && error.code === 'USER_REJECTED') {
    return;
  }

  const detail = error instanceof Error ? error.message : String(error);

  await notifyAction({ title, status: 'failed', detail });
}
