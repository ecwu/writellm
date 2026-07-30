import { toast } from 'sonner'

export const ACTION_ERROR_TOAST_DURATION_MS = 8_000

export function notifyActionError(message: string): void {
  toast.error('Action failed', {
    id: `action-error:${message}`,
    description: message,
    duration: ACTION_ERROR_TOAST_DURATION_MS,
    closeButton: true
  })
}
