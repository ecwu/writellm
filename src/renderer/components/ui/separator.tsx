import type { HTMLAttributes } from 'react';
export function Separator(p: HTMLAttributes<HTMLHRElement>) {
  return <hr className="ui-separator" {...p} />;
}
