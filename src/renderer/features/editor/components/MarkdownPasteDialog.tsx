import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import { ClipboardPaste } from 'lucide-react';
import type { MarkdownPastePreview } from '../../../../shared/chapters';
export function MarkdownPasteDialog({
  preview,
  onConfirm,
  onCancel,
}: {
  preview: MarkdownPastePreview | null;
  onConfirm(): void;
  onCancel(): void;
}) {
  return (
    <Dialog
      open={Boolean(preview)}
      onOpenChange={(open) => {
        if (!open) onCancel();
      }}
    >
      <DialogContent className="workspace-leave-dialog">
        <DialogTitle>Paste Markdown?</DialogTitle>
        <DialogDescription>
          Review conversion warnings before inserting this content.
        </DialogDescription>
        {preview?.warnings.map((warning, index) => (
          <p role="alert" key={index}>
            {warning.message}
          </p>
        ))}
        <Button autoFocus onClick={onConfirm}>
          <ClipboardPaste aria-hidden="true" focusable="false" />
          Insert converted blocks
        </Button>
        <Button variant="secondary" onClick={onCancel}>
          Cancel
        </Button>
      </DialogContent>
    </Dialog>
  );
}
