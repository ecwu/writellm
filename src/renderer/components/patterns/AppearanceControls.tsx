import { Select } from '@/components/ui/select';
import type { AppearancePreferences, ThemeMode } from '../../../shared/appearance';
import { StatusNotice } from './StatusNotice';
export function AppearanceControls({
  preferences,
  pending,
  message,
  onChange,
}: {
  preferences: AppearancePreferences;
  pending: boolean;
  message?: string;
  onChange: (v: AppearancePreferences) => void;
}) {
  return (
    <div className="appearance-controls">
      <label htmlFor="theme-mode">Theme</label>
      <Select
        id="theme-mode"
        value={preferences.themeMode}
        disabled={pending}
        onChange={(e) => onChange({ ...preferences, themeMode: e.target.value as ThemeMode })}
      >
        <option value="system">System</option>
        <option value="light">Light</option>
        <option value="dark">Dark</option>
      </Select>
      {pending ? <span role="status">Saving theme…</span> : null}
      {message ? <StatusNotice tone="warning">{message}</StatusNotice> : null}
    </div>
  );
}
