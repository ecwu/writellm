import { cloneElement, type ReactElement, type ReactNode, useId } from 'react';
import { Label } from '@/components/ui/label';
export function FormField({
  label,
  description,
  error,
  children,
}: {
  label: string;
  description?: string;
  error?: string;
  children: ReactElement;
}) {
  const id = useId(),
    descriptionId = `${id}-description`,
    errorId = `${id}-error`;
  return (
    <div className="form-field">
      <Label htmlFor={id}>{label}</Label>
      {cloneElement(children as ReactElement<Record<string, unknown>>, {
        id,
        'aria-describedby':
          [description && descriptionId, error && errorId].filter(Boolean).join(' ') || undefined,
        'aria-invalid': error ? true : undefined,
      })}
      {description ? (
        <p id={descriptionId} className="field-description">
          {description}
        </p>
      ) : null}
      {error ? (
        <p id={errorId} className="field-error">
          {error}
        </p>
      ) : null}
    </div>
  );
}
