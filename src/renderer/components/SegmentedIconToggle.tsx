import type { ReactNode } from 'react';
import { ToggleGroup, ToggleGroupItem } from './ui/toggle-group';
import { cn } from '../lib/utils';

export type SegmentedIconToggleOption<TValue extends string> = {
  value: TValue;
  label: string;
  icon: ReactNode;
  disabled?: boolean;
};

export function SegmentedIconToggle<TValue extends string>({
  value,
  options,
  label,
  className,
  onValueChange
}: {
  value: TValue;
  options: SegmentedIconToggleOption<TValue>[];
  label: string;
  className?: string;
  onValueChange: (value: TValue) => void;
}) {
  return (
    <ToggleGroup
      type="single"
      value={value}
      variant="outline"
      size="sm"
      spacing={0}
      aria-label={label}
      className={cn('segmented-icon-toggle', className)}
      onValueChange={(nextValue) => {
        if (nextValue) {
          onValueChange(nextValue as TValue);
        }
      }}
    >
      {options.map((option) => (
        <ToggleGroupItem
          key={option.value}
          value={option.value}
          disabled={option.disabled}
          className="segmented-icon-toggle-item"
          aria-label={option.label}
          title={option.label}
        >
          {option.icon}
          <span className="sr-only">{option.label}</span>
        </ToggleGroupItem>
      ))}
    </ToggleGroup>
  );
}
