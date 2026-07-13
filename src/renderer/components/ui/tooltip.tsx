import { Tooltip as TooltipPrimitive } from '@base-ui/react/tooltip';
import type { ReactElement } from 'react';
import { cn } from '@/lib/cn';

export const TooltipProvider = ({ delay = 0, ...props }: TooltipPrimitive.Provider.Props) => (
  <TooltipPrimitive.Provider data-slot="tooltip-provider" delay={delay} {...props} />
);
export const Tooltip = (props: TooltipPrimitive.Root.Props) => (
  <TooltipPrimitive.Root data-slot="tooltip" {...props} />
);

export function TooltipContent({
  className,
  side = 'top',
  sideOffset = 4,
  align = 'center',
  alignOffset = 0,
  children,
  ...props
}: TooltipPrimitive.Popup.Props &
  Pick<TooltipPrimitive.Positioner.Props, 'align' | 'alignOffset' | 'side' | 'sideOffset'>) {
  return (
    <TooltipPrimitive.Portal>
      <TooltipPrimitive.Positioner
        align={align}
        alignOffset={alignOffset}
        side={side}
        sideOffset={sideOffset}
        className="pointer-events-none isolate z-50"
      >
        <TooltipPrimitive.Popup
          role="tooltip"
          data-slot="tooltip-content"
          className={cn(
            'ui-tooltip pointer-events-none z-50 inline-flex w-fit max-w-xs origin-(--transform-origin) items-center gap-1.5 rounded-none bg-foreground px-3 py-1.5 text-xs text-background data-open:animate-in data-open:fade-in-0 data-open:zoom-in-95 data-closed:animate-out data-closed:fade-out-0 data-closed:zoom-out-95',
            className,
          )}
          {...props}
        >
          {children}
          <TooltipPrimitive.Arrow className="pointer-events-none z-50 size-2.5 rotate-45 rounded-none bg-foreground fill-foreground" />
        </TooltipPrimitive.Popup>
      </TooltipPrimitive.Positioner>
    </TooltipPrimitive.Portal>
  );
}

export function TooltipTrigger({
  children,
  content,
  ...props
}: Omit<TooltipPrimitive.Trigger.Props, 'render'> & { children: ReactElement; content?: string }) {
  const trigger = (
    <TooltipPrimitive.Trigger data-slot="tooltip-trigger" render={children} {...props} />
  );
  if (!content) return trigger;
  return (
    <Tooltip>
      <>
        {trigger}
        <TooltipContent>{content}</TooltipContent>
      </>
    </Tooltip>
  );
}
