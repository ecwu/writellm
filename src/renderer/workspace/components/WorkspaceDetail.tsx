import type { ReactNode } from 'react';
import { ScrollArea } from '@/components/ui/scroll-area';
export function WorkspaceDetail({ label, children }: { label: string; children: ReactNode }) {
  return (
    <main
      className="flex h-full min-h-0 min-w-0 flex-1 flex-col overflow-hidden outline-none"
      aria-label={label}
      tabIndex={-1}
    >
      <ScrollArea className="h-0 min-h-0 flex-1" aria-label={`${label} content`}>
        {children}
      </ScrollArea>
    </main>
  );
}
