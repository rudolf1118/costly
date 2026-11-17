import { cn } from './cn';

/** The mark: a geometric open C ring with a dot. Decorative; the wordmark carries the name. */
export function LogoMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 100 100" aria-hidden="true" className={cn('shrink-0', className)}>
      <path
        d="M71.21 28.79 A30 30 0 1 0 71.21 71.21"
        fill="none"
        stroke="currentColor"
        strokeWidth="16"
      />
      <circle cx="80" cy="50" r="8" fill="currentColor" />
    </svg>
  );
}

/** The mark and the "costly." wordmark. */
export function Logo({ compact = false, className }: { compact?: boolean; className?: string }) {
  return (
    <span className={cn('inline-flex items-center gap-2.5', className)}>
      <LogoMark className="size-6 text-accent-text" />
      <span
        className={cn(
          'text-[1.25rem] leading-none font-semibold tracking-[-0.045em] text-text',
          compact && 'sr-only',
        )}
      >
        costly<span className="text-accent-text">.</span>
      </span>
    </span>
  );
}
