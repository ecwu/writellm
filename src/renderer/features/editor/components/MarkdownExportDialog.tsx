import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import { Download } from 'lucide-react';
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
      <DialogContent>
        <DialogTitle>Export Markdown</DialogTitle>
        <DialogDescription>
          The preview below is the exact UTF-8 text that will be exported.
        </DialogDescription>
        {preview?.warnings.map((warning, index) => (
          <p role="alert" key={index}>
            {warning.message}
          </p>
        ))}
        <pre className="max-h-64 overflow-auto whitespace-pre-wrap bg-muted p-3">
          {preview?.markdown}
        </pre>
        <Button autoFocus busy={busy} onClick={onExport}>
          <Download aria-hidden="true" focusable="false" />
          Choose export location
        </Button>
        <Button variant="secondary" disabled={busy} onClick={onCancel}>
          Cancel
        </Button>
      </DialogContent>
    </Dialog>
  );
}
