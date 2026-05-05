
import { Clock, FileText, FolderOpen, FolderPlus } from 'lucide-react';
import { formatRecentWorkspaceDate } from '../app/formatters';
import { Button } from '../components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '../components/ui/dialog';
import {
  Field,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel
} from '../components/ui/field';
import { Input } from '../components/ui/input';
import { Item, ItemContent, ItemDescription, ItemGroup, ItemMedia, ItemTitle } from '../components/ui/item';
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
  const hasPath = Boolean(workspacePath.trim());

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
        <DialogTitle className="sr-only">Choose a writellm workspace</DialogTitle>
        <DialogDescription className="sr-only">
          Open a recent project, create a new .writellm workspace, or select one from the system.
        </DialogDescription>

        <div className="workspace-dialog-shell">
          <aside className="workspace-dialog-sidebar">
            <div className="workspace-dialog-brand">
              <span className="workspace-dialog-brand-icon">
                <FileText />
              </span>
              <span className="workspace-dialog-brand-copy">
                <strong>writellm</strong>
                <span>Workspace</span>
              </span>
            </div>

            <div className="workspace-dialog-actions" aria-label="Workspace actions">
              <Button
                className="workspace-dialog-action"
                variant="outline"
                onClick={onPickWorkspace}
                disabled={!apiAvailable}
              >
                <FolderOpen />
                Open
              </Button>
              <Button
                className="workspace-dialog-action"
                onClick={onPickNewWorkspace}
                disabled={!apiAvailable}
              >
                <FolderPlus />
                New
              </Button>
            </div>

            <FieldGroup className="workspace-dialog-path">
              <Field data-invalid={!apiAvailable}>
                <FieldLabel htmlFor="workspace-path-input">Path</FieldLabel>
                <Input
                  id="workspace-path-input"
                  value={workspacePath}
                  onChange={(event) => onWorkspacePath(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter' && canUsePath) {
                      onOpenWorkspace(workspacePath);
                    }
                  }}
                  placeholder="/path/to/project.writellm"
                  aria-label="Workspace path"
                  aria-invalid={!apiAvailable}
                />
                {!apiAvailable ? (
                  <FieldError>Workspace file access is not available in this environment.</FieldError>
                ) : (
                  <FieldDescription>
                    {hasPath ? 'Open an existing workspace or create a new one at this path.' : 'Enter a .writellm workspace path.'}
                  </FieldDescription>
                )}
              </Field>
              <div className="workspace-path-row">
                <Button variant="outline" onClick={() => onOpenWorkspace(workspacePath)} disabled={!canUsePath}>
                  Open
                </Button>
                <Button onClick={() => onCreateWorkspace(workspacePath)} disabled={!canUsePath}>
                  Create
                </Button>
              </div>
            </FieldGroup>
          </aside>

          <main className="workspace-dialog-main">
            <header className="workspace-dialog-main-header">
              <div>
                <h2>Recent projects</h2>
                <p>{recentWorkspaces.length} saved workspace{recentWorkspaces.length === 1 ? '' : 's'}</p>
              </div>
            </header>

            {recentWorkspaces.length > 0 ? (
              <ItemGroup className="workspace-recent-list">
                {recentWorkspaces.map((workspace) => (
                  <Item
                    key={workspace.path}
                    variant="outline"
                    size="sm"
                    className="workspace-recent-item"
                    role="button"
                    tabIndex={apiAvailable ? 0 : -1}
                    aria-disabled={!apiAvailable}
                    onClick={() => {
                      if (apiAvailable) {
                        onOpenWorkspace(workspace.path);
                      }
                    }}
                    onKeyDown={(event) => {
                      if (!apiAvailable) {
                        return;
                      }
                      if (event.key === 'Enter' || event.key === ' ') {
                        event.preventDefault();
                        onOpenWorkspace(workspace.path);
                      }
                    }}
                  >
                    <ItemMedia variant="icon" className="workspace-recent-icon">
                      <FileText />
                    </ItemMedia>
                    <ItemContent className="workspace-recent-main">
                      <ItemTitle>{workspace.name}</ItemTitle>
                      <ItemDescription>{workspace.path}</ItemDescription>
                    </ItemContent>
                    <span className="workspace-recent-time">
                      <Clock />
                      {formatRecentWorkspaceDate(workspace.openedAt)}
                    </span>
                  </Item>
                ))}
              </ItemGroup>
            ) : (
              <p className="workspace-dialog-empty">No recent projects yet.</p>
            )}
          </main>
        </div>
      </DialogContent>
    </Dialog>
  );
}
