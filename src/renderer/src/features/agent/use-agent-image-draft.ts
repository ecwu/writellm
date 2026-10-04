import { useCallback, useEffect, useRef, useState } from 'react'
import {
  AGENT_IMAGE_MAX_BYTES,
  type AgentAttachment
} from '../../../../shared/contracts/agent-attachments'
import { reportAgentImageError, type AgentImageDraft } from './agent-image-attachments'
import { errorMessage } from './agent-panel-logic'

export function useAgentImageDraft(input: {
  projectSessionId: string
  agentSessionId: string | null
  ensureSession(): Promise<string>
  onError(message: string): void
}) {
  const [drafts, setDrafts] = useState<Record<string, AgentImageDraft[]>>({})
  const draftsRef = useRef(drafts)
  const projectRef = useRef(input.projectSessionId)
  const mounted = useRef(true)
  const update = (key: string, change: (items: AgentImageDraft[]) => AgentImageDraft[]): void => {
    const next = { ...draftsRef.current, [key]: change(draftsRef.current[key] ?? []) }
    draftsRef.current = next
    if (mounted.current) setDrafts(next)
  }
  const release = useCallback(
    async (sessionId: string, image: AgentAttachment): Promise<void> => {
      try {
        await window.desktop.agent.releaseImage({
          projectSessionId: input.projectSessionId,
          agentSessionId: sessionId,
          attachmentId: image.attachmentId
        })
      } catch (err) {
        reportAgentImageError(err, 'agent.image.release')
      }
    },
    [input.projectSessionId]
  )
  useEffect(() => {
    mounted.current = true
    if (projectRef.current !== input.projectSessionId) {
      projectRef.current = input.projectSessionId
      draftsRef.current = {}
      setDrafts({})
    }
    return () => {
      mounted.current = false
      for (const [session, items] of Object.entries(draftsRef.current)) {
        if (session === 'new') continue
        for (const item of items) if (item.image) void release(session, item.image)
      }
    }
  }, [release, input.projectSessionId])
  const begin = async (
    names: string[]
  ): Promise<{ session: string; ids: string[]; project: string } | null> => {
    const key = input.agentSessionId ?? 'new'
    if ((draftsRef.current[key] ?? []).some((item) => item.state === 'processing')) {
      input.onError('Wait for image processing to finish.')
      return null
    }
    if ((draftsRef.current[key]?.length ?? 0) + names.length > 4) {
      input.onError('Each message accepts up to four images.')
      return null
    }
    const ids: string[] = names.map(() => globalThis.crypto.randomUUID())
    update(key, (items) => [
      ...items,
      ...names.map((name, index) => ({ id: ids[index], name, state: 'processing' as const }))
    ])
    const project = input.projectSessionId
    try {
      const session = input.agentSessionId ?? (await input.ensureSession())
      if (projectRef.current !== project || !mounted.current) return null
      if (key === 'new') {
        const reserved = (draftsRef.current[key] ?? []).filter((item) => ids.includes(item.id))
        update(session, (items) => [...items, ...reserved])
        update(key, (items) => items.filter((item) => !ids.includes(item.id)))
      }
      return { session, ids, project }
    } catch (err) {
      reportAgentImageError(err, 'agent.image.import')
      update(key, (items) => items.filter((item) => !ids.includes(item.id)))
      input.onError(errorMessage(err))
      return null
    }
  }
  const settle = async (
    batch: { session: string; project: string },
    id: string,
    image: AgentAttachment
  ): Promise<void> => {
    if (
      !mounted.current ||
      projectRef.current !== batch.project ||
      !draftsRef.current[batch.session]?.some((item) => item.id === id)
    ) {
      await release(batch.session, image)
      return
    }
    update(batch.session, (items) =>
      items.map((item) => (item.id === id ? { id, name: image.name, state: 'done', image } : item))
    )
  }
  const importFiles = async (files: File[]): Promise<void> => {
    const batch = await begin(files.map((file) => file.name || 'Pasted image'))
    if (!batch) return
    for (const [index, file] of files.entries()) {
      const id = batch.ids[index]
      try {
        if (file.size > AGENT_IMAGE_MAX_BYTES)
          throw new Error('Images must be smaller than 20 MiB.')
        if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type))
          throw new Error('Use PNG, JPEG, or static WebP images.')
        const dataBase64 = await new Promise<string>((resolve, reject) => {
          const reader = new FileReader()
          reader.onerror = () => reject(reader.error ?? new Error('Image could not be read'))
          reader.onload = () => resolve(String(reader.result).split(',')[1] ?? '')
          reader.readAsDataURL(file)
        })
        if (projectRef.current !== batch.project || !mounted.current) return
        const image = await window.desktop.agent.importImage({
          projectSessionId: batch.project,
          agentSessionId: batch.session,
          dataBase64,
          mimeType: file.type as 'image/png' | 'image/jpeg' | 'image/webp',
          name: file.name || 'Pasted image'
        })
        await settle(batch, id, image)
      } catch (err) {
        reportAgentImageError(err, 'agent.image.import')
        update(batch.session, (items) =>
          items.map((item) =>
            item.id === id ? { ...item, state: 'error', error: errorMessage(err) } : item
          )
        )
      }
    }
  }
  const selectImages = async (): Promise<void> => {
    const batch = await begin(['Choose images'])
    if (!batch) return
    const placeholder = batch.ids[0]
    try {
      const remaining = 5 - (draftsRef.current[batch.session]?.length ?? 1)
      const result = await window.desktop.agent.selectImages({
        projectSessionId: batch.project,
        agentSessionId: batch.session,
        remaining
      })
      const present = draftsRef.current[batch.session]?.some((item) => item.id === placeholder)
      update(batch.session, (items) => items.filter((item) => item.id !== placeholder))
      for (const image of result.attachments) {
        if (!present || projectRef.current !== batch.project || !mounted.current)
          await release(batch.session, image)
        else
          update(batch.session, (items) => [
            ...items,
            { id: image.attachmentId, name: image.name, state: 'done', image }
          ])
      }
      if (result.errors.length) input.onError(result.errors.join(' '))
    } catch (err) {
      reportAgentImageError(err, 'agent.image.import')
      update(batch.session, (items) => items.filter((item) => item.id !== placeholder))
      input.onError(errorMessage(err))
    }
  }
  const pasteImage = async (): Promise<void> => {
    const batch = await begin(['Pasted image'])
    if (!batch) return
    try {
      const image = await window.desktop.agent.pasteImage({
        projectSessionId: batch.project,
        agentSessionId: batch.session
      })
      if (image) await settle(batch, batch.ids[0], image)
      else update(batch.session, (items) => items.filter((item) => item.id !== batch.ids[0]))
    } catch (err) {
      reportAgentImageError(err, 'agent.image.import')
      update(batch.session, (items) => items.filter((item) => item.id !== batch.ids[0]))
      input.onError(errorMessage(err))
    }
  }
  const key = input.agentSessionId ?? 'new'
  const items = drafts[key] ?? []
  const remove = (id: string): void => {
    const item = draftsRef.current[key]?.find((item) => item.id === id)
    update(key, (items) => items.filter((item) => item.id !== id))
    if (item?.image && input.agentSessionId) void release(input.agentSessionId, item.image)
  }
  const clear = (session: string, sentIds: string[]): void => {
    update(session, (items) =>
      items.filter((item) => !item.image || !sentIds.includes(item.image.attachmentId))
    )
  }
  return {
    items,
    importing: items.some((item) => item.state === 'processing'),
    attachmentIds: items.flatMap((item) => (item.image ? [item.image.attachmentId] : [])),
    importFiles,
    selectImages,
    pasteImage,
    remove,
    clear
  }
}
