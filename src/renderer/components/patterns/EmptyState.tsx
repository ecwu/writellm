import type { ReactNode } from 'react';
export function EmptyState({
  title,
  description,
  action,
}: {
  title: string;
  description: string;
  action?: ReactNode;
}) {
  return (
    <div className="grid gap-2 p-6 text-muted-foreground">
      <h3 className="text-sm font-medium text-foreground">{title}</h3>
      <p className="m-0 text-xs">{description}</p>
      {action}
    </div>
  );
}
