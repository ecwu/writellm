import { useQueryClient, type QueryKey } from '@tanstack/react-query'
import { useRef, type RefObject } from 'react'
import type {
  EditorFlushRequest,
  ManuscriptWorkspace
} from '../../../../shared/contracts/manuscript'
import { useDesktopSubscription } from '@/hooks/use-desktop-subscription'
import { reportRendererOperationError } from '../../diagnostics'
import type { SectionEditorHandle } from './section-editor'

export function useWorkspaceFinalFlush(options: {
  projectSessionId: string
  workspaceKey: QueryKey
  editorRef: RefObject<SectionEditorHandle | null>
  activeSectionIdRef: RefObject<string | null>
  saveLayout(closingToken: string): Promise<void>
  saveMetadata(): Promise<boolean>
  onFailure(): void
}): void {
  const queryClient = useQueryClient()
  const saveMetadataRef = useRef(options.saveMetadata)
  saveMetadataRef.current = options.saveMetadata
  const session = { projectSessionId: options.projectSessionId }

  const flush = async (request: EditorFlushRequest): Promise<void> => {
    await options.saveLayout(request.closingToken)
    const mutation = request.purpose === 'mutation'
    if (mutation && !(await saveMetadataRef.current())) {
      throw new Error('Section metadata flush failed')
    }

    const metadataOnly = mutation && !request.bodyRequired
    const editor = options.editorRef.current
    if (!metadataOnly && editor && editor.hasActiveEditor?.(request.sectionId) !== false) {
      await editor.finalFlush(request)
      return
    }

    let { sectionId, sectionRevisionId } = request
    if (sectionId === undefined || sectionRevisionId === undefined) {
      if (metadataOnly) throw new Error('Metadata-only flush is missing its active revision')
      const workspace =
        queryClient.getQueryData<ManuscriptWorkspace>(options.workspaceKey) ??
        (await window.desktop.manuscript.workspace(session))
      sectionId = options.activeSectionIdRef.current ?? workspace.sections[0]?.section.sectionId
      if (sectionId === undefined) throw new Error('No section is available for final flush')
      const current = await window.desktop.editor.loadSection({ ...session, sectionId })
      sectionRevisionId = current.revision.sectionRevisionId
    }
    await window.desktop.editor.acknowledgeFlush({ ...request, sectionId, sectionRevisionId })
  }

  useDesktopSubscription<EditorFlushRequest>(
    (listener) => window.desktop.editor.subscribeFlush(session, listener),
    (request) => {
      void flush(request).catch((err: unknown) => {
        reportRendererOperationError(err, 'writing-workspace.final-flush')
        options.onFailure()
      })
    },
    {
      source: 'writing-workspace.flush-subscription',
      dependencies: [options.projectSessionId],
      onError: options.onFailure
    }
  )
}
