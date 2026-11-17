import * as ToggleGroup from '@radix-ui/react-toggle-group';
import type { CSSProperties } from 'react';
import { cn } from './cn';

export interface SegmentedOption<T extends string> {
  value: T;
  label: string;
}

export interface SegmentedControlProps<T extends string> {
  /** Names the group for screen readers, such as "Period". */
  label: string;
  /** `NoInfer` here and on `onValueChange`: the type comes from `value` alone. */
  options: readonly SegmentedOption<NoInfer<T>>[];
  value: T;
  onValueChange(value: NoInfer<T>): void;
  className?: string;
}

/**
 * A single choice among two to five short options, such as a period picker.
 * Arrow keys move between options. One option is always selected: pressing
 * the selected one again does nothing. One indicator slides between options
 * (Motion board: move it, never re-mount it).
 */
export function SegmentedControl<T extends string>({
  label,
  options,
  value,
  onValueChange,
  className,
}: SegmentedControlProps<T>) {
  const index = options.findIndex((option) => option.value === value);
  const indicator: CSSProperties = {
    width: `calc((100% - 6px) / ${options.length})`,
    transform: `translateX(${Math.max(index, 0) * 100}%)`,
  };

  return (
    <ToggleGroup.Root
      type="single"
      aria-label={label}
      value={value}
      onValueChange={(next) => {
        if (next) onValueChange(next as T);
      }}
      className={cn(
        'relative inline-grid h-9 w-fit auto-cols-fr grid-flow-col rounded-md bg-subtle p-[3px]',
        className,
      )}
    >
      {index >= 0 && (
        <span
          aria-hidden="true"
          style={indicator}
          className={cn(
            'absolute top-[3px] bottom-[3px] left-[3px] rounded-sm bg-surface shadow-e1',
            'transition-transform duration-240 ease-select',
            'in-data-[theme=dark]:bg-raised',
          )}
        />
      )}
      {options.map((option) => (
        <ToggleGroup.Item
          key={option.value}
          value={option.value}
          className={cn(
            'relative z-10 cursor-pointer rounded-sm px-3 text-label whitespace-nowrap',
            'text-text-secondary transition-colors duration-160 ease-control',
            'hover:text-text data-[state=on]:text-text',
          )}
        >
          {option.label}
        </ToggleGroup.Item>
      ))}
    </ToggleGroup.Root>
  );
}
