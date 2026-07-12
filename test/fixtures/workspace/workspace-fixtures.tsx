import type {
  OwnerStatusSummary,
  ToolPanelDescriptor,
} from '../../../src/renderer/workspace/workspaceSession';
export const project = { projectId: 'project-002', displayName: 'A Long Writing Project' } as const;
export const panels: readonly ToolPanelDescriptor[] = [
  { id: 'sources', label: 'Sources', render: () => <p>Source panel content</p> },
  { id: 'outline', label: 'Outline', render: () => <p>Outline panel content</p> },
  { id: 'future', label: 'Unavailable future tool', disabled: true, render: () => null },
];
export const status = (overrides: Partial<OwnerStatusSummary> = {}): OwnerStatusSummary => ({
  sourceId: 'editor',
  sequence: 1,
  state: 'in-progress',
  severity: 'info',
  message: 'Drafting in progress',
  ...overrides,
});
export function ObservableSlot() {
  return (
    <div data-testid="observable-slot">
      <label>
        Draft
        <input defaultValue="Persistent text" />
      </label>
      <div style={{ height: 1200 }}>Scrollable content</div>
    </div>
  );
}
