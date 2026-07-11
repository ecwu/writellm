
import { BookOpenCheck, FileText } from 'lucide-react';
import { SegmentedIconToggle } from '../components/SegmentedIconToggle';
import type { ChildViewMode } from '../app/types';

export function ViewModeToggle({
  mode,
  onModeChange
}: {
  mode: ChildViewMode;
  onModeChange: (mode: ChildViewMode) => void;
}) {
  return (
    <SegmentedIconToggle
      value={mode}
      label="Children view mode"
      className="view-mode-toggle"
      onValueChange={onModeChange}
      options={[
        { value: 'references', label: 'Evidence coverage', icon: <BookOpenCheck /> },
        { value: 'markdown', label: 'Markdown view', icon: <FileText /> }
      ]}
    />
  );
}

export function ChildrenViewHeader({
  title,
  detail,
  mode,
  onModeChange
}: {
  title: string;
  detail: string;
  mode: ChildViewMode;
  onModeChange: (mode: ChildViewMode) => void;
}) {
  return (
    <div className="children-view-header">
      <div className="children-view-title">
        <h1>{title}</h1>
        <p className="muted">{detail}</p>
      </div>
      <ViewModeToggle mode={mode} onModeChange={onModeChange} />
    </div>
  );
}
