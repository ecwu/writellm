import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import type { MarkdownPreview } from '../../../../shared/chapters';
export function MarkdownExportDialog({
  preview,
  busy,
  onExport,
  onCancel,
}: {
  preview: MarkdownPreview | null;
  busy: boolean;
  onExport(): void;
  onCancel(): void;
}) {
  return (
    <Dialog
      open={Boolean(preview)}
      onOpenChange={(open) => {
        if (!open && !busy) onCancel();
      }}
    >
      <DialogContent className="workspace-leave-dialog">
        <DialogTitle>Export Markdown</DialogTitle>
        <DialogDescription>
          The preview below is the exact UTF-8 text that will be exported.
        </DialogDescription>
        {preview?.warnings.map((warning, index) => (
          <p role="alert" key={index}>
            {warning.message}
          </p>
        ))}
        <pre className="markdown-preview">{preview?.markdown}</pre>
        <Button autoFocus disabled={busy} onClick={onExport}>
          Choose export location
        </Button>
        <Button disabled={busy} onClick={onCancel}>
          Cancel
        </Button>
      </DialogContent>
    </Dialog>
  );
}
