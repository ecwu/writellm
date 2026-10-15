import { describe, expect, it, vi } from 'vitest'
import { harness as chatHarness, completed, sourceA } from './knowledge-chat-service.test-support'
import { NotebookRegistry } from './notebook-registry'

async function harness() {
  const fixture = await chatHarness()
  return { ...fixture, registry: new NotebookRegistry(fixture.serviceOptions) }
}

describe('Notebook instance ownership', () => {
  it('keeps background turns isolated and cancels only the destroyed instance', async () => {
    const { registry, runtime } = await harness()
    runtime.block = true
    const first = registry.createInstance()
    const second = registry.createInstance()
    const concurrent = await Promise.allSettled([
      first.startTurn('First ongoing answer'),
      first.startTurn('Duplicate preparation')
    ])
    expect(concurrent.filter((result) => result.status === 'fulfilled')).toHaveLength(1)
    expect(concurrent.filter((result) => result.status === 'rejected')).toHaveLength(1)
    await second.startTurn('Second ongoing answer')
    await vi.waitFor(() => expect(runtime.calls).toHaveLength(2))
    await expect(first.startTurn('Duplicate')).rejects.toThrow()
    await registry.destroyInstance(first.notebookId)
    await expect(first.snapshot()).rejects.toThrow('closed')
    const ongoing = await second.snapshot()
    expect(ongoing.phase).not.toBe('idle')
    expect(JSON.stringify(ongoing.messages)).not.toContain('First ongoing answer')
    const closing = registry.close()
    expect(registry.close()).toBe(closing)
    expect(() => registry.instance(second.notebookId)).toThrow('closed')
    await closing
    await expect(second.snapshot()).rejects.toThrow('closed')
  })

  it('waits for a detached Notebook cleanup when the project closes concurrently', async () => {
    const { registry } = await harness()
    const notebook = registry.createInstance()
    let finish!: () => void
    const cleanup = new Promise<void>((resolve) => {
      finish = resolve
    })
    vi.spyOn(notebook, 'close').mockReturnValue(cleanup)
    const destroying = registry.destroyInstance(notebook.notebookId)
    expect(() => registry.instance(notebook.notebookId)).toThrow('unavailable')
    let closed = false
    const closing = registry.close().then(() => {
      closed = true
    })
    await Promise.resolve()
    expect(closed).toBe(false)
    finish()
    await Promise.all([destroying, closing])
    expect(closed).toBe(true)
    expect(notebook.close).toHaveBeenCalledTimes(1)
  })

  it('isolates source scopes and messages, limits instances, and revokes all children on close', async () => {
    const { registry } = await harness()
    const first = registry.createInstance()
    const second = registry.createInstance()
    expect(first.notebookId).not.toBe(second.notebookId)
    await first.setSources({ mode: 'selected', knowledgeItemIds: [sourceA] })
    expect((await second.snapshot()).sourceScope).toEqual({ mode: 'all', knowledgeItemIds: [] })
    await first.startTurn('Question in the first notebook')
    await completed(first)
    expect((await first.snapshot()).messages.length).toBeGreaterThan(0)
    expect((await second.snapshot()).messages).toEqual([])
    for (let index = 2; index < 10; index++) registry.createInstance()
    expect(() => registry.createInstance()).toThrow('10 Notebooks')
    await registry.destroyInstance(first.notebookId)
    expect(() => registry.instance(first.notebookId)).toThrow('unavailable')
    await expect(first.snapshot()).rejects.toThrow('closed')
    expect((await second.snapshot()).messages).toEqual([])
    registry.createInstance()
    await registry.close()
    await expect(second.snapshot()).rejects.toThrow('closed')
    expect(() => registry.createInstance()).toThrow('closed')
  })
})
