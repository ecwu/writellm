
import { Clock, FileText, FolderOpen, FolderPlus } from 'lucide-react';
import { formatRecentWorkspaceDate } from '../app/formatters';
import { Button } from '../components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '../components/ui/dialog';
import { Input } from '../components/ui/input';
import type { RecentWorkspace } from '../../shared/types';

export function WorkspaceChooserDialog({
  open,
  apiAvailable,
  canClose,
  recentWorkspaces,
  workspacePath,
  onOpenChange,
  onWorkspacePath,
  onOpenWorkspace,
  onCreateWorkspace,
  onPickWorkspace,
  onPickNewWorkspace
}: {
  open: boolean;
  apiAvailable: boolean;
  canClose: boolean;
  recentWorkspaces: RecentWorkspace[];
  workspacePath: string;
  onOpenChange: (open: boolean) => void;
  onWorkspacePath: (path: string) => void;
  onOpenWorkspace: (path: string) => void;
  onCreateWorkspace: (path: string) => void;
  onPickWorkspace: () => void;
  onPickNewWorkspace: () => void;
}) {
  const canUsePath = apiAvailable && Boolean(workspacePath.trim());

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="workspace-dialog"
        showCloseButton={canClose}
        onEscapeKeyDown={(event) => {
          if (!canClose) {
            event.preventDefault();
          }
        }}
        onPointerDownOutside={(event) => {
          if (!canClose) {
            event.preventDefault();
          }
        }}
      >
        <DialogHeader>
          <DialogTitle>Choose a PaperLab workspace</DialogTitle>
          <DialogDescription>
            Open a recent project, create a new .paperlab workspace, or select one from the system.
          </DialogDescription>
        </DialogHeader>

        <div className="workspace-dialog-actions">
          <Button onClick={onPickNewWorkspace} disabled={!apiAvailable}>
            <FolderPlus />
            New project
          </Button>
          <Button variant="outline" onClick={onPickWorkspace} disabled={!apiAvailable}>
            <FolderOpen />
            Choose folder
          </Button>
        </div>

        <section className="workspace-dialog-section">
          <div className="workspace-dialog-section-header">
            <h2>Recent projects</h2>
          </div>
          {recentWorkspaces.length > 0 ? (
            <div className="workspace-recent-list">
              {recentWorkspaces.map((workspace) => (
                <button
                  key={workspace.path}
                  className="workspace-recent-item"
                  type="button"
                  onClick={() => onOpenWorkspace(workspace.path)}
                  disabled={!apiAvailable}
                >
                  <span className="workspace-recent-icon">
                    <FileText />
                  </span>
                  <span className="workspace-recent-main">
                    <strong>{workspace.name}</strong>
                    <span>{workspace.path}</span>
                  </span>
                  <span className="workspace-recent-time">
                    <Clock />
                    {formatRecentWorkspaceDate(workspace.openedAt)}
                  </span>
                </button>
              ))}
            </div>
          ) : (
            <p className="workspace-dialog-empty">No recent projects yet.</p>
          )}
        </section>

        <section className="workspace-dialog-section">
          <div className="workspace-dialog-section-header">
            <h2>Path</h2>
          </div>
          <div className="workspace-path-row">
            <Input
              value={workspacePath}
              onChange={(event) => onWorkspacePath(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' && canUsePath) {
                  onOpenWorkspace(workspacePath);
                }
              }}
              placeholder="/path/to/project.paperlab"
              aria-label="Workspace path"
            />
            <Button variant="outline" onClick={() => onOpenWorkspace(workspacePath)} disabled={!canUsePath}>
              Open
            </Button>
            <Button onClick={() => onCreateWorkspace(workspacePath)} disabled={!canUsePath}>
              Create
            </Button>
          </div>
        </section>
      </DialogContent>
    </Dialog>
  );
}
