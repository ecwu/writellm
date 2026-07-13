import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import {
  ArrowDown,
  ArrowUp,
  ClipboardPaste,
  Download,
  FolderOpen,
  FolderPlus,
  PanelTop,
  Plus,
  Save,
  Trash2,
  X,
} from 'lucide-react';
import { Button } from '../../../src/renderer/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogTrigger,
} from '../../../src/renderer/components/ui/dialog';
import { WorkspaceShell } from '../../../src/renderer/workspace/WorkspaceShell';
import { TooltipTrigger } from '../../../src/renderer/components/ui/tooltip';
import '../../../src/renderer/styles.css';

const project = { projectId: 'runtime-project', displayName: 'Runtime workspace' };
const panels = [
  {
    id: 'details',
    label: 'Details',
    icon: PanelTop,
    render: () => <p>Long panel content for runtime focus and scrolling.</p>,
  },
];

const icon = { 'aria-hidden': true, focusable: false } as const;
function RuntimeActionMatrix() {
  return (
    <section aria-label="Icon action runtime matrix" className="runtime-action-matrix">
      <fieldset className="card-actions">
        <legend>Launch actions</legend>
        <Button>
          <FolderPlus {...icon} />
          Create project
        </Button>
        <Button variant="secondary">
          <FolderOpen {...icon} />
          Open project
        </Button>
      </fieldset>
      <fieldset className="card-actions">
        <legend>Outline actions</legend>
        <Button variant="secondary">
          <Plus {...icon} />
          Add outline item
        </Button>
        <TooltipTrigger content="Move Introduction up">
          <Button size="icon" variant="secondary" aria-label="Move Introduction up">
            <ArrowUp {...icon} />
          </Button>
        </TooltipTrigger>
        <TooltipTrigger content="Move Introduction down">
          <Button size="icon" variant="secondary" aria-label="Move Introduction down">
            <ArrowDown {...icon} />
          </Button>
        </TooltipTrigger>
        <Button variant="destructive">
          <Trash2 {...icon} />
          Delete item
        </Button>
      </fieldset>
      <fieldset className="chapter-actions">
        <legend>Editor actions</legend>
        <Button variant="secondary">
          <ClipboardPaste {...icon} />
          Paste Markdown
        </Button>
        <Button variant="secondary">
          <Download {...icon} />
          Export Markdown
        </Button>
        <Button busy>
          <Save {...icon} />
          Saving…
        </Button>
      </fieldset>
      <TooltipTrigger content="Close Details">
        <Button size="icon" variant="ghost" aria-label="Close Details">
          <X {...icon} />
        </Button>
      </TooltipTrigger>
      <p role="status">Unsaved changes. Save before leaving.</p>
    </section>
  );
}
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
          <RuntimeActionMatrix />
        </div>
      }
    />
  </StrictMode>,
);
