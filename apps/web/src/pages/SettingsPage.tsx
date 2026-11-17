import { useRouteContext } from '@tanstack/react-router';
import { HealthStatus } from '../health/HealthStatus';
import { useTheme } from '../theme/ThemeProvider';
import type { ThemePreference } from '../theme/theme';
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

  return (
    <div className="flex flex-col gap-6">
      <PageHeader title="Settings" />

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
