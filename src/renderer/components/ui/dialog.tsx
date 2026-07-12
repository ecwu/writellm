import {
  cloneElement,
  createContext,
  type HTMLAttributes,
  type ReactElement,
  type ReactNode,
  useContext,
  useEffect,
  useId,
  useRef,
  useState,
} from 'react';
import { createPortal } from 'react-dom';

const focusable =
  'button:not([disabled]),a[href],input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])';
type DialogContext = {
  open: boolean;
  setOpen(v: boolean): void;
  titleId: string;
  trigger: HTMLElement | null;
  setTrigger(v: HTMLElement | null): void;
};
const Context = createContext<DialogContext | null>(null);
export function Dialog({
  children,
  open: controlled,
  onOpenChange,
}: {
  children: ReactNode;
  open?: boolean;
  onOpenChange?: (v: boolean) => void;
}) {
  const [local, setLocal] = useState(false);
  const [trigger, setTrigger] = useState<HTMLElement | null>(null);
  const titleId = useId();
  const open = controlled ?? local;
  const setOpen = (v: boolean) => {
    if (controlled === undefined) setLocal(v);
    onOpenChange?.(v);
  };
  return (
    <Context.Provider value={{ open, setOpen, titleId, trigger, setTrigger }}>
      {children}
    </Context.Provider>
  );
}
export function DialogTrigger({ children }: { children: ReactElement }) {
  const c = useContext(Context)!;
  return cloneElement(children as ReactElement<Record<string, unknown>>, {
    ref: (node: HTMLElement | null) => c.setTrigger(node),
    onClick: (event: React.MouseEvent) => {
      (children.props as { onClick?: (e: React.MouseEvent) => void }).onClick?.(event);
      if (!event.defaultPrevented) c.setOpen(true);
    },
  });
}
export function DialogContent({
  children,
  className,
  onKeyDown,
  ...props
}: HTMLAttributes<HTMLDivElement>) {
  const c = useContext(Context)!;
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!c.open) return;
    const siblings = [...document.body.children].filter(
      (node) => !node.hasAttribute('data-dialog-portal'),
    );
    const prior = siblings.map((node) => ({
      node,
      inert: (node as HTMLElement).inert,
      aria: node.getAttribute('aria-hidden'),
    }));
    for (const { node } of prior) {
      (node as HTMLElement).inert = true;
      node.setAttribute('aria-hidden', 'true');
    }
    queueMicrotask(() =>
      (
        ref.current?.querySelector<HTMLElement>('[autofocus]') ??
        ref.current?.querySelector<HTMLElement>(focusable) ??
        ref.current
      )?.focus(),
    );
    return () => {
      for (const { node, inert, aria } of prior) {
        (node as HTMLElement).inert = inert;
        aria === null
          ? node.removeAttribute('aria-hidden')
          : node.setAttribute('aria-hidden', aria);
      }
      queueMicrotask(() => {
        if (c.trigger?.isConnected) c.trigger.focus();
        else
          document.body
            .querySelector<HTMLElement>(
              '[data-dialog-focus-fallback],button,a[href],input,select,textarea,[tabindex]:not([tabindex="-1"])',
            )
            ?.focus();
      });
    };
  }, [c.open, c.trigger]);
  if (!c.open) return null;
  return createPortal(
    <div
      data-dialog-portal
      className="ui-dialog-backdrop"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) c.setOpen(false);
      }}
    >
      <div
        {...props}
        ref={ref}
        role="dialog"
        aria-modal="true"
        aria-labelledby={c.titleId}
        tabIndex={-1}
        className={className ?? 'ui-dialog'}
        onKeyDown={(e) => {
          onKeyDown?.(e);
          if (e.defaultPrevented) return;
          if (e.key === 'Escape') {
            e.preventDefault();
            c.setOpen(false);
          }
          if (e.key === 'Tab') {
            const items = [...(ref.current?.querySelectorAll<HTMLElement>(focusable) ?? [])].filter(
              (item) => !item.hidden,
            );
            if (!items.length) {
              e.preventDefault();
              ref.current?.focus();
              return;
            }
            const first = items[0],
              last = items.at(-1)!;
            if (e.shiftKey && document.activeElement === first) {
              e.preventDefault();
              last.focus();
            } else if (!e.shiftKey && document.activeElement === last) {
              e.preventDefault();
              first.focus();
            }
          }
        }}
      >
        {children}
      </div>
    </div>,
    document.body,
  );
}
export function DialogTitle(props: HTMLAttributes<HTMLHeadingElement>) {
  const c = useContext(Context)!;
  return <h2 id={c.titleId} {...props} />;
}
export const DialogDescription = (props: HTMLAttributes<HTMLParagraphElement>) => <p {...props} />;
export function DialogClose({ children }: { children: ReactElement }) {
  const c = useContext(Context)!;
  return cloneElement(children as ReactElement<Record<string, unknown>>, {
    onClick: (event: React.MouseEvent) => {
      (children.props as { onClick?: (e: React.MouseEvent) => void }).onClick?.(event);
      if (!event.defaultPrevented) c.setOpen(false);
    },
  });
}
