import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
export function ChapterConflictDialog({
  open,
  onKeep,
  onReload,
  onCancel,
}: {
  open: boolean;
  onKeep(): void;
  onReload(): void;
  onCancel(): void;
}) {
  return (
    <Dialog
      open={open}
      onOpenChange={(value) => {
        if (!value) onCancel();
      }}
    >
      <DialogContent className="workspace-leave-dialog">
        <DialogTitle>Saved chapter changed</DialogTitle>
        <DialogDescription>
          Another view saved this chapter. Keep your current draft or reload the saved version.
        </DialogDescription>
        <Button autoFocus onClick={onKeep}>
          Keep current draft
        </Button>
        <Button onClick={onReload}>Reload saved</Button>
        <Button onClick={onCancel}>Cancel</Button>
      </DialogContent>
    </Dialog>
  );
}
