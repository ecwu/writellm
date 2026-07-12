import { BlockNoteView } from '@blocknote/ariakit';
import { useCreateBlockNote } from '@blocknote/react';
import '@blocknote/ariakit/style.css';
export function EditorRuntimeFixture() {
  const editor = useCreateBlockNote({
    initialContent: [{ type: 'paragraph', content: 'Compiled editor' }],
  });
  return <BlockNoteView editor={editor} data-testid="compiled-blocknote" />;
}
