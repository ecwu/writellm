import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { Button } from '../../../src/renderer/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogTrigger,
} from '../../../src/renderer/components/ui/dialog';
import { WorkspaceShell } from '../../../src/renderer/workspace/WorkspaceShell';
import '../../../src/renderer/styles.css';

const project = { projectId: 'runtime-project', displayName: 'Runtime workspace' };
const panels = [
  {
    id: 'details',
    label: 'Details',
    render: () => <p>Long panel content for runtime focus and scrolling.</p>,
  },
];
createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <WorkspaceShell
      project={project}
      panels={panels}
      statuses={[
        {
          sourceId: 'runtime',
          sequence: 1,
          state: 'in-progress',
          severity: 'info',
          message: 'Runtime status',
        },
      ]}
      onLeaveWorkspace={() => {}}
      workspaceSlot={
        <div className="typeset typeset-editor">
          <h1>UI foundation fixture</h1>
          <Dialog>
            <DialogTrigger>
              <Button>Open dialog</Button>
            </DialogTrigger>
            <DialogContent>
              <DialogTitle>Focus fixture</DialogTitle>
              <Button>Close target</Button>
            </DialogContent>
          </Dialog>
          <p data-streaming="stable">Append-stable prose.</p>
        </div>
      }
    />
  </StrictMode>,
);
