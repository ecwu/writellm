import type { ReactNode } from 'react';
import { CircleCheck, CircleX, Info, TriangleAlert } from 'lucide-react';
import { Alert } from '@/components/ui/alert';
export function StatusNotice({
  tone = 'info',
  urgent = false,
  children,
}: {
  tone?: 'info' | 'success' | 'warning' | 'error';
  urgent?: boolean;
  children: ReactNode;
}) {
  const Icon =
    tone === 'success'
      ? CircleCheck
      : tone === 'warning'
        ? TriangleAlert
        : tone === 'error'
          ? CircleX
          : Info;
  return (
    <Alert
      className={`status-notice status-${tone}`}
      role={urgent || tone === 'error' ? 'alert' : 'status'}
      aria-live={urgent ? 'assertive' : 'polite'}
    >
      <Icon aria-hidden="true" focusable="false" className="status-notice-icon" />
      <span>{children}</span>
    </Alert>
  );
}
