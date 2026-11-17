import { useRouteContext } from '@tanstack/react-router';
import { useState } from 'react';
import { useSessionState, useSessionStore } from '../auth/SessionContext';
import { HealthStatus } from '../health/HealthStatus';
import { useTheme } from '../theme/ThemeProvider';
import type { ThemePreference } from '../theme/theme';
import { Button } from '../ui/Button';
import { Card } from '../ui/Card';
import { PageHeader } from '../ui/PageHeader';
import { SegmentedControl } from '../ui/SegmentedControl';

const THEMES = [
  { value: 'system', label: 'System' },
  { value: 'light', label: 'Light' },
  { value: 'dark', label: 'Dark' },
] as const;

export function SettingsPage() {
  const { apiBaseUrl } = useRouteContext({ from: '__root__' });
  const { preference, setPreference } = useTheme();
  const session = useSessionStore();
  const state = useSessionState();
  const [signingOut, setSigningOut] = useState(false);
  const user = state.status === 'authenticated' ? state.user : null;

  return (
    <div className="flex flex-col gap-6">
      <PageHeader title="Settings" />

      {user && (
        <Card className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex min-w-0 flex-col gap-1">
            <h2 className="text-title-card">Account</h2>
            <p className="text-body break-all text-text-secondary">
              Signed in as <span className="text-text">{user.email}</span>
            </p>
            <p className="text-body-small text-text-secondary">
              Time zone {user.timezone.replace(/_/g, ' ')} · Currency {user.baseCurrency}
            </p>
          </div>
          <Button
            variant="secondary"
            loading={signingOut}
            onClick={async () => {
              setSigningOut(true);
              await session.logout();
            }}
          >
            Sign out
          </Button>
        </Card>
      )}

      <Card className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex flex-col gap-1">
          <h2 className="text-title-card">Appearance</h2>
          <p className="text-body text-text-secondary">
            System follows your device&rsquo;s light or dark setting.
          </p>
        </div>
        <SegmentedControl<ThemePreference>
          label="Theme"
          options={THEMES}
          value={preference}
          onValueChange={setPreference}
        />
      </Card>

      <Card>
        <HealthStatus apiBaseUrl={apiBaseUrl} />
      </Card>
    </div>
  );
}
