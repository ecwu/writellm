import type { ContextNavigationItem } from '../../../src/renderer/workspace/components/ContextNavigationList';

export const navigationProject = {
  projectId: 'workspace-navigation-project',
  displayName: 'A deliberately long workspace project name',
} as const;

export const sectionNavigationItems: readonly ContextNavigationItem[] = [
  {
    id: 'section-intro',
    title: 'Introduction',
    description: 'Frame the central question.',
    status: 'In progress',
    meta: 'Chapter linked',
  },
  {
    id: 'section-long',
    title: 'A very long section title that remains available to assistive technology',
    description:
      'A similarly long intention summary used to exercise dense rows and visual truncation without truncating the accessible name.',
    status: 'Not started',
    meta: 'Chapter not created',
  },
];

export const sourceNavigationItems: readonly ContextNavigationItem[] = [
  {
    id: 'source-ready',
    title: 'research.pdf',
    description: '12 of 12 blocks indexed',
    status: 'Available',
    meta: 'Searchable',
  },
  {
    id: 'source-partial',
    title: 'field-notes.pdf',
    description: '8 of 15 blocks indexed',
    status: 'Partially available',
    meta: 'Limited search',
  },
];

export const staleSelection = { selectedId: 'removed-item', validIds: ['section-intro'] } as const;
export const emptyOwnerItems: readonly ContextNavigationItem[] = [];

export function PersistentOwnerFixture({ label = 'Owner state' }: { label?: string }) {
  return (
    <label>
      {label}
      <input defaultValue="unsaved owner draft" />
    </label>
  );
}
