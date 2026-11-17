import { ChevronDown } from 'lucide-react';
import { forwardRef, type ReactNode, type SelectHTMLAttributes, useId } from 'react';
import { cn } from './cn';

export interface SelectFieldProps extends Omit<SelectHTMLAttributes<HTMLSelectElement>, 'size'> {
  label: ReactNode;
  hint?: ReactNode;
  error?: ReactNode;
  size?: 'md' | 'lg';
  options: readonly { value: string; label: string }[];
}

/**
 * A labelled native select, styled like TextField. Native, so the platform's
 * own picker, keyboard search and screen-reader support come with it.
 */
export const SelectField = forwardRef<HTMLSelectElement, SelectFieldProps>(function SelectField(
  { label, hint, error, size = 'md', options, id, className, ...props },
  ref,
) {
  const generated = useId();
  const selectId = id ?? generated;
  const messageId = `${selectId}-message`;
  const message = error ?? hint;

  return (
    <div className={cn('flex flex-col gap-1.5', className)}>
      <label htmlFor={selectId} className="text-body-small font-medium text-text">
        {label}
      </label>
      <div className="relative">
        <select
          ref={ref}
          id={selectId}
          aria-invalid={error ? true : undefined}
          aria-describedby={message ? messageId : undefined}
          className={cn(
            'w-full cursor-pointer appearance-none rounded-sm border bg-surface pr-9 pl-3 text-body text-text',
            'transition-[border-color,box-shadow] duration-160 ease-control',
            'focus-visible:border-accent focus-visible:shadow-[0_0_0_3px_var(--color-accent-soft-strong)] focus-visible:outline-none',
            error ? 'border-negative' : 'border-border-strong',
            size === 'lg' ? 'h-11' : 'h-10',
          )}
          {...props}
        >
          {options.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
        <ChevronDown
          aria-hidden="true"
          strokeWidth={1.5}
          className="pointer-events-none absolute top-1/2 right-3 size-4 -translate-y-1/2 text-text-secondary"
        />
      </div>
      {message && (
        <p
          id={messageId}
          className={cn('text-body-small', error ? 'text-negative' : 'text-text-secondary')}
        >
          {message}
        </p>
      )}
    </div>
  );
});
