import { cloneElement, type ReactElement, type ReactNode, useId, useRef, useState } from 'react';
export const TooltipProvider = ({ children }: { children: ReactNode }) => <>{children}</>;
export function Tooltip({ children }: { children: ReactNode }) {
  return <>{children}</>;
}
export function TooltipTrigger({
  children,
  content,
}: {
  children: ReactElement;
  content?: string;
}) {
  const id = useId();
  const [focusOpen, setFocusOpen] = useState(false);
  const [pointerOpen, setPointerOpen] = useState(false);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const open = focusOpen || pointerOpen;
  const cancelClose = () => {
    if (closeTimer.current) clearTimeout(closeTimer.current);
    setPointerOpen(true);
  };
  const scheduleClose = () => {
    closeTimer.current = setTimeout(() => setPointerOpen(false), 50);
  };
  const props = children.props as Record<string, unknown>;
  return (
    <span className="ui-tooltip-anchor" onMouseEnter={cancelClose} onMouseLeave={scheduleClose}>
      {cloneElement(children as ReactElement<Record<string, unknown>>, {
        'aria-describedby': open ? id : undefined,
        onFocus: (e: React.FocusEvent) => {
          (props.onFocus as ((e: React.FocusEvent) => void) | undefined)?.(e);
          setFocusOpen(true);
        },
        onBlur: (e: React.FocusEvent) => {
          (props.onBlur as ((e: React.FocusEvent) => void) | undefined)?.(e);
          setFocusOpen(false);
        },
        onKeyDown: (e: React.KeyboardEvent) => {
          (props.onKeyDown as ((e: React.KeyboardEvent) => void) | undefined)?.(e);
          if (e.key === 'Escape') {
            setFocusOpen(false);
            setPointerOpen(false);
          }
        },
      })}
      {open && content ? (
        <span
          role="tooltip"
          id={id}
          className="ui-tooltip"
          onMouseEnter={cancelClose}
          onMouseLeave={scheduleClose}
        >
          {content}
        </span>
      ) : null}
    </span>
  );
}
export const TooltipContent = ({ children }: { children: ReactNode }) => (
  <span className="ui-tooltip">{children}</span>
);
