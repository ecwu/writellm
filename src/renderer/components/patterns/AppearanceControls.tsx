import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
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
    <div className="grid max-w-60 gap-2">
      <Label htmlFor="theme-mode">Theme</Label>
      <Select
        value={preferences.themeMode}
        disabled={pending}
        onValueChange={(value) => onChange({ ...preferences, themeMode: value as ThemeMode })}
      >
        <SelectTrigger id="theme-mode" className="w-full">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="system">System</SelectItem>
          <SelectItem value="light">Light</SelectItem>
          <SelectItem value="dark">Dark</SelectItem>
        </SelectContent>
      </Select>
      {pending ? <span role="status">Saving theme…</span> : null}
      {message ? <StatusNotice tone="warning">{message}</StatusNotice> : null}
    </div>
  );
}
