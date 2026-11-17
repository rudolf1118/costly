import type { typeScale } from '@costly/design-tokens';
import { type ReactNode, useState } from 'react';
import { useTheme } from '../theme/ThemeProvider';
import type { ThemePreference } from '../theme/theme';
import { Button } from '../ui/Button';
import { Card } from '../ui/Card';
import { Dialog, DialogClose, DialogContent, DialogTrigger } from '../ui/Dialog';
import { SegmentedControl } from '../ui/SegmentedControl';
import { Skeleton } from '../ui/Skeleton';
import { TextField } from '../ui/TextField';

/** Written out in full: Tailwind only generates classes it can find as literal text. */
const TYPE_CLASSES: Record<keyof typeof typeScale, string> = {
  'display-xl': 'text-display-xl',
  'display-l': 'text-display-l',
  'heading-page': 'text-heading-page',
  'heading-section': 'text-heading-section',
  'title-card': 'text-title-card',
  body: 'text-body',
  'body-small': 'text-body-small',
  label: 'text-label',
  caption: 'text-caption',
};

/**
 * Every base component in every state, for checking them against the
 * design's Components board in both themes. Development only (ui.html).
 * The amounts are sample text, not data.
 */
export function UiPreview() {
  const { preference, setPreference } = useTheme();
  const [period, setPeriod] = useState<'1w' | '1m' | '3m' | '1y'>('1m');

  return (
    <main className="mx-auto flex max-w-6xl flex-col gap-10 px-4 py-10 sm:px-8">
      <header className="flex flex-wrap items-center justify-between gap-4 border-b border-border pb-5">
        <h1 className="text-heading-page">UI components</h1>
        <SegmentedControl<ThemePreference>
          label="Theme"
          value={preference}
          onValueChange={setPreference}
          options={[
            { value: 'system', label: 'System' },
            { value: 'light', label: 'Light' },
            { value: 'dark', label: 'Dark' },
          ]}
        />
      </header>

      <Section title="Buttons">
        {(['primary', 'secondary', 'ghost', 'destructive'] as const).map((variant) => (
          <div key={variant} className="flex flex-wrap items-center gap-3">
            <span className="w-24 text-label text-text-secondary">{variant}</span>
            <Button variant={variant}>Add expense</Button>
            <Button variant={variant} disabled>
              Disabled
            </Button>
            <Button variant={variant} loading>
              Loading
            </Button>
            <Button variant={variant} size="sm">
              Small
            </Button>
            <Button variant={variant} size="lg">
              Large
            </Button>
          </div>
        ))}
      </Section>

      <Section title="Text fields">
        <div className="grid gap-6 sm:grid-cols-2">
          <TextField label="Email" type="email" placeholder="name@example.com" size="lg" />
          <TextField label="Name" hint="Up to 64 characters" defaultValue="Main bank account" />
          <TextField
            label="Opening balance"
            inputMode="decimal"
            defaultValue="250,000"
            suffix="֏"
          />
          <TextField label="Account name" error="Give the account a name" />
          <TextField label="Currency" value="AMD" disabled readOnly />
        </div>
      </Section>

      <Section title="Segmented control">
        <SegmentedControl
          label="Period"
          value={period}
          onValueChange={setPeriod}
          options={[
            { value: '1w', label: '1W' },
            { value: '1m', label: '1M' },
            { value: '3m', label: '3M' },
            { value: '1y', label: '1Y' },
          ]}
        />
      </Section>

      <Section title="Cards and loading">
        <div className="grid gap-4 sm:grid-cols-3">
          <Card className="flex flex-col gap-2">
            <span className="text-title-card">Sample card</span>
            <span className="text-display-l tabular-nums">
              1,284,500 <span className="text-heading-section text-text-secondary">֏</span>
            </span>
            <span className="text-body-small text-text-secondary">Opening balance</span>
          </Card>
          <Card aria-busy="true" className="flex flex-col gap-3">
            <Skeleton className="h-5 w-32" />
            <Skeleton className="h-9 w-48" />
            <Skeleton className="h-4 w-24" />
          </Card>
          <Card className="flex flex-col gap-1 bg-subtle">
            <span className="text-body text-positive">+ 850,000 ֏</span>
            <span className="text-body text-text">− 18,400 ֏</span>
            <span className="text-body text-negative">▲ 18% over</span>
            <span className="text-body text-warning">Due in 2 days</span>
            <span className="text-body text-accent-text">View all</span>
          </Card>
        </div>
      </Section>

      <Section title="Dialogs">
        <div className="flex flex-wrap gap-3">
          {(['modal', 'drawer'] as const).map((variant) => (
            <Dialog key={variant}>
              <DialogTrigger asChild>
                <Button variant="secondary">Open {variant}</Button>
              </DialogTrigger>
              <DialogContent
                variant={variant}
                title="Add account"
                description="You enter balances yourself. Costly never connects to your bank."
              >
                <TextField label="Name" />
                <TextField label="Opening balance" suffix="֏" inputMode="decimal" />
                <div className="flex justify-end gap-2">
                  <DialogClose asChild>
                    <Button variant="secondary">Cancel</Button>
                  </DialogClose>
                  <Button>Add account</Button>
                </div>
              </DialogContent>
            </Dialog>
          ))}
        </div>
      </Section>

      <Section title="Type">
        <div className="flex flex-col gap-3">
          {Object.entries(TYPE_CLASSES).map(([style, className]) => (
            <div key={style} className="flex items-baseline gap-4">
              <span className="w-36 shrink-0 font-mono text-caption text-text-secondary">
                {style}
              </span>
              <span className={`${className} tabular-nums`}>3,678,200 ֏ · Ամսական ծախսեր</span>
            </div>
          ))}
        </div>
      </Section>
    </main>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-4">
      <h2 className="text-heading-section">{title}</h2>
      {children}
    </section>
  );
}
