import { StrictMode, useReducer } from 'react';
import { createRoot } from 'react-dom/client';
import { ContextNavigationList } from '../../../src/renderer/workspace/components/ContextNavigationList';
import { WorkspaceCategoryRail } from '../../../src/renderer/workspace/components/WorkspaceCategoryRail';
import { WorkspaceDetail } from '../../../src/renderer/workspace/components/WorkspaceDetail';
import { WorkspaceLocationHeader } from '../../../src/renderer/workspace/components/WorkspaceLocationHeader';
import { WorkspaceNavigationFrame } from '../../../src/renderer/workspace/components/WorkspaceNavigationFrame';
import {
  createWorkspaceNavigationSession,
  workspaceNavigationSessionReducer,
} from '../../../src/renderer/workspace/workspaceNavigationSession';
import {
  navigationProject,
  sectionNavigationItems,
} from '../../fixtures/workspace/workspace-navigation-fixtures';
import '../../../src/renderer/styles.css';

function Fixture() {
  const [session, dispatch] = useReducer(
    workspaceNavigationSessionReducer,
    createWorkspaceNavigationSession(navigationProject.projectId),
  );
  const selected = session.lastValidItemId.sections;
  return (
    <WorkspaceNavigationFrame
      settingsOpen={false}
      sidebarExpanded={session.sidebarExpanded}
      compactPane={session.compactPane}
      onToggleSidebar={() => dispatch({ type: 'sidebar.toggle' })}
      rail={
        <WorkspaceCategoryRail
          project={navigationProject}
          activeCategory={session.activeCategory}
          settingsOpen={false}
          registerTrigger={() => () => {}}
          onCategory={(category) => dispatch({ type: 'category.activate', category })}
          onSettings={() => {}}
          onLeave={() => {}}
        />
      }
      context={
        <ContextNavigationList
          label="Sections"
          items={sectionNavigationItems}
          selectedId={selected}
          onSelect={(itemId) => dispatch({ type: 'item.activate', category: 'sections', itemId })}
        />
      }
      detail={
        <WorkspaceDetail label="Section detail">
          <WorkspaceLocationHeader
            project={navigationProject.displayName}
            category="Sections"
            item={sectionNavigationItems.find((item) => item.id === selected)?.title}
            showBack
            onBack={() => dispatch({ type: 'list.show' })}
          />
          <h1>{selected ? 'Selected section' : 'Choose a section'}</h1>
        </WorkspaceDetail>
      }
    />
  );
}
createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Fixture />
  </StrictMode>,
);
