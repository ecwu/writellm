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
      className={
        tone === 'error'
          ? 'border-0 bg-transparent px-0 py-1 text-destructive shadow-none'
          : 'border-0 bg-transparent px-0 py-1 text-muted-foreground shadow-none'
      }
      role={urgent || tone === 'error' ? 'alert' : 'status'}
      aria-live={urgent ? 'assertive' : 'polite'}
    >
      <Icon aria-hidden="true" focusable="false" className="size-4" />
      <span>{children}</span>
    </Alert>
  );
}
