import type { ReactNode } from 'react';
import { ScrollArea } from '@/components/ui/scroll-area';
export type ContextNavigationItem = {
  id: string;
  title: string;
  description?: string;
  status: string;
  meta?: string;
  progress?: { value: number; max: number; label: string; text: string };
};
type Props = {
  label: string;
  description?: string;
  items: readonly ContextNavigationItem[];
  selectedId: string | null;
  empty?: ReactNode;
  action?: ReactNode;
  registerItem?: (id: string, node: HTMLButtonElement | null) => void;
  onSelect(id: string): void;
};
export function ContextNavigationList({
  label,
  description,
  items,
  selectedId,
  empty,
  action,
  registerItem,
  onSelect,
}: Props) {
  return (
    <section
      className="context-navigation flex h-full min-h-0 flex-col"
      aria-labelledby="context-navigation-heading"
    >
      <header className="context-navigation-header flex min-h-16 items-start justify-between gap-3 border-b border-sidebar-border p-4">
        <div>
          <h2 id="context-navigation-heading" className="cn-font-heading text-sm font-medium">
            {label}
          </h2>
          {description && (
            <p className="mt-1 text-xs leading-5 text-muted-foreground">{description}</p>
          )}
        </div>
        {action}
      </header>
      <ScrollArea className="context-navigation-scroll min-h-0 flex-1" aria-label={`${label} list`}>
        {items.length === 0 ? (
          (empty ?? (
            <p className="context-navigation-empty p-4 text-xs text-muted-foreground">
              No items yet.
            </p>
          ))
        ) : (
          <ul className="context-navigation-list m-0 list-none p-0">
            {items.map((item) => (
              <li key={item.id}>
                <button
                  ref={(node) => registerItem?.(item.id, node)}
                  type="button"
                  className="context-navigation-item flex min-h-11 w-full flex-col items-start gap-1 border-0 border-b border-sidebar-border bg-transparent p-3 text-left text-xs leading-tight outline-none transition-colors last:border-b-0 hover:bg-sidebar-accent focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-sidebar-ring aria-[current=page]:bg-sidebar-accent"
                  aria-current={selectedId === item.id ? 'page' : undefined}
                  aria-label={[
                    item.title,
                    item.description,
                    item.status,
                    item.meta,
                    item.progress?.text,
                  ]
                    .filter(Boolean)
                    .join('. ')}
                  onClick={() => onSelect(item.id)}
                >
                  <span className="context-navigation-title w-full truncate font-medium">
                    {item.title}
                  </span>
                  {item.description && (
                    <span className="context-navigation-description line-clamp-2 text-xs leading-5 text-muted-foreground">
                      {item.description}
                    </span>
                  )}
                  <span className="context-navigation-state flex w-full justify-between gap-2 text-xs text-muted-foreground">
                    <span>{item.status}</span>
                    {item.meta && <span>{item.meta}</span>}
                  </span>
                  {item.progress && (
                    <span className="grid w-full gap-1 text-xs text-muted-foreground">
                      <progress
                        className="h-1.5 w-full accent-primary"
                        value={item.progress.value}
                        max={item.progress.max}
                        aria-label={item.progress.label}
                      />
                      <span aria-hidden="true">{item.progress.text}</span>
                    </span>
                  )}
                </button>
              </li>
            ))}
          </ul>
        )}
      </ScrollArea>
    </section>
  );
}
