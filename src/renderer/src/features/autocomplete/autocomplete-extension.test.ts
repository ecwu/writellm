import { history, undo, redo } from 'prosemirror-history'
import { BlockNoteEditor } from '@blocknote/core'
import { TextSelection, NodeSelection, type Transaction } from 'prosemirror-state'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { approvedEditorSchema } from '../manuscript/editor-schema'
import {
  autocompleteContext,
  autocompleteExtension,
  autocompletePluginKey,
  refreshAutocomplete
} from './autocomplete-extension'
import type { EditorView } from 'prosemirror-view'
import type {
  AutocompleteApi,
  AutocompleteRequest,
  AutocompleteResult
} from '../../../../shared/contracts/autocomplete'
import { autocompleteRequestSchema } from '../../../../shared/contracts/autocomplete'

function stateAt(
  text: string,
  offset: number,
  type: 'paragraph' | 'heading' | 'bulletListItem' | 'codeBlock' = 'paragraph'
) {
  const editor = BlockNoteEditor.create({
    schema: approvedEditorSchema,
    initialContent: [
      { id: 'earlier', type: 'paragraph', content: 'Earlier context.' },
      { id: 'current', type, content: text },
      { id: 'later', type: 'paragraph', content: 'Never sent as suffix.' }
    ]
  })
  const state = editor._tiptapEditor.state
  let start = 0
  state.doc.descendants((node, position) => {
    if (node.attrs.id === 'current') start = position + 2
  })
  return state.apply(state.tr.setSelection(TextSelection.create(state.doc, start + offset)))
}
describe('autocomplete context', () => {
  it('uses Chat Prefix at the current block end even when later blocks exist', () => {
    expect(autocompleteContext(stateAt('Current block.', 14))).toEqual({
      blockId: 'current',
      atBlockEnd: true,
      prefix: 'Earlier context.\nCurrent block.',
      suffix: ''
    })
  })
  it('uses FIM inside a block and preserves trailing whitespace', () => {
    expect(autocompleteContext(stateAt('Start end ', 5))).toMatchObject({
      atBlockEnd: false,
      prefix: 'Earlier context.\nStart',
      suffix: ' end '
    })
    expect(autocompleteContext(stateAt('Start ', 5))).toMatchObject({
      atBlockEnd: false,
      suffix: ' '
    })
  })
  it.each(['paragraph', 'heading', 'bulletListItem'] as const)('supports %s text', (type) => {
    expect(autocompleteContext(stateAt('中文测试', 4, type))).toMatchObject({
      atBlockEnd: true,
      blockId: 'current'
    })
  })
  it('excludes code and selected text', () => {
    expect(autocompleteContext(stateAt('const x = 1', 5, 'codeBlock'))).toBeNull()
    const state = stateAt('hello', 2)
    expect(
      autocompleteContext(
        state.apply(
          state.tr.setSelection(
            TextSelection.create(state.doc, state.selection.from, state.selection.from + 1)
          )
        )
      )
    ).toBeNull()
    expect(
      autocompleteContext(state.apply(state.tr.setSelection(NodeSelection.create(state.doc, 0))))
    ).toBeNull()
  })
  it('bounds prefix and suffix by Unicode characters without splitting surrogate pairs', () => {
    const context = autocompleteContext(stateAt('😀'.repeat(12_000), 18_000))
    if (context === null) throw new Error('Expected autocomplete context')
    expect([...context.prefix]).toHaveLength(8_000)
    expect([...context.suffix]).toHaveLength(2_000)
    expect(context.prefix).toBe('😀'.repeat(8_000))
    expect(context.suffix).toBe('😀'.repeat(2_000))
  })
  it('validates IPC size and block-end consistency', () => {
    const base = {
      requestId: '00000000-0000-4000-8000-000000000001',
      projectSessionId: '00000000-0000-4000-8000-000000000002',
      sectionId: '00000000-0000-4000-8000-000000000003',
      blockId: 'block',
      generation: 0,
      prefix: '😀'.repeat(8_000),
      suffix: '',
      atBlockEnd: true
    }
    expect(autocompleteRequestSchema.safeParse(base).success).toBe(true)
    expect(
      autocompleteRequestSchema.safeParse({ ...base, prefix: 'x'.repeat(8_001) }).success
    ).toBe(false)
    expect(autocompleteRequestSchema.safeParse({ ...base, suffix: ' ' }).success).toBe(false)
    expect(autocompleteRequestSchema.safeParse({ ...base, credential: 'forbidden' }).success).toBe(
      false
    )
  })
})

function interactive(text = 'Start', completion = ' recommendation') {
  vi.useFakeTimers()
  const host = { blocked: false, enabled: true, composing: false, focused: true }
  const api = {
    complete: vi.fn(
      async (input: AutocompleteRequest): Promise<AutocompleteResult> => ({
        requestId: input.requestId,
        generation: input.generation,
        status: 'suggestion',
        text: completion
      })
    ),
    cancel: vi.fn(async () => undefined),
    accepted: vi.fn(async () => undefined)
  }
  const onStatus = vi.fn()
  const onError = vi.fn()
  const editor = BlockNoteEditor.create({
    schema: approvedEditorSchema,
    initialContent: [{ id: 'block', type: 'paragraph', content: text }],
    extensions: [
      autocompleteExtension({
        api: api as unknown as AutocompleteApi,
        projectSessionId: '00000000-0000-4000-8000-000000000002',
        sectionId: '00000000-0000-4000-8000-000000000003',
        enabled: () => host.enabled,
        blocked: () => host.blocked,
        composing: () => host.composing,
        onStatus,
        onError
      })
    ]
  })
  const plugin = editor.getExtension(autocompleteExtension)?.prosemirrorPlugins[0]
  if (!plugin?.spec.view) throw new Error('Missing plugin')
  let state = editor._tiptapEditor.state.reconfigure({ plugins: [history(), plugin] })
  let start = 0
  state.doc.descendants((node, position) => {
    if (node.isTextblock && start === 0) start = position + 1
  })
  state = state.apply(state.tr.setSelection(TextSelection.create(state.doc, start + text.length)))
  const view = {
    state,
    editable: true,
    composing: false,
    hasFocus: () => host.focused,
    dispatch(tr: Transaction) {
      const previous = view.state
      view.state = previous.applyTransaction(tr).state
      lifecycle.update?.(view, previous)
    }
  } as unknown as EditorView
  const lifecycle = plugin.spec.view(view)
  const event = (name: 'focus' | 'blur' | 'compositionstart' | 'compositionend') => {
    plugin.props.handleDOMEvents?.[name]?.call(
      plugin,
      view,
      new Event(name) as FocusEvent & CompositionEvent
    )
  }
  const key = (key: string, extra: Partial<KeyboardEvent> = {}) => {
    const event = { key, preventDefault: vi.fn(), ...extra } as unknown as KeyboardEvent
    return plugin.props.handleDOMEvents?.keydown?.call(plugin, view, event)
  }
  const insert = (value: string) => view.dispatch(view.state.tr.insertText(value))
  const move = (position: number) =>
    view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, position)))
  const suggestion = () => autocompletePluginKey.getState(view.state)?.suggestion?.text
  return {
    view,
    host,
    api,
    event,
    key,
    insert,
    move,
    suggestion,
    onStatus,
    onError,
    async suggest() {
      event('focus')
      await vi.advanceTimersByTimeAsync(600)
    },
    destroy() {
      lifecycle.destroy?.()
    }
  }
}
afterEach(() => vi.useRealTimers())
describe('autocomplete interactions', () => {
  it('requests after Tab at 200ms, supports repeated acceptance and one undo per acceptance', async () => {
    const h = interactive()
    await h.suggest()
    h.key('Tab')
    expect(h.view.state.doc.textContent).toBe('Start recommendation')
    await vi.advanceTimersByTimeAsync(199)
    expect(h.api.complete).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(1)
    expect(h.api.complete).toHaveBeenCalledTimes(2)
    expect(h.api.complete.mock.calls[1][0]).toMatchObject({
      trigger: 'accept',
      prefix: 'Start recommendation'
    })
    h.key('Tab', { repeat: true })
    expect(h.api.accepted).toHaveBeenCalledTimes(1)
    h.key('Tab')
    expect(h.view.state.doc.textContent).toBe('Start recommendation recommendation')
    undo(h.view.state, h.view.dispatch)
    expect(h.view.state.doc.textContent).toBe('Start recommendation')
    undo(h.view.state, h.view.dispatch)
    expect(h.view.state.doc.textContent).toBe('Start')
    await vi.advanceTimersByTimeAsync(1_000)
    expect(h.api.complete).toHaveBeenCalledTimes(2)
    redo(h.view.state, h.view.dispatch)
    h.event('blur')
    h.event('focus')
    await vi.advanceTimersByTimeAsync(1_000)
    expect(h.api.complete).toHaveBeenCalledTimes(2)
    h.insert('!')
    await vi.advanceTimersByTimeAsync(600)
    expect(h.api.complete).toHaveBeenCalledTimes(3)
    h.destroy()
  })
  it('replaces the acceptance debounce when typing resumes', async () => {
    const h = interactive()
    await h.suggest()
    h.key('Tab')
    await vi.advanceTimersByTimeAsync(100)
    h.insert('!')
    await vi.advanceTimersByTimeAsync(599)
    expect(h.api.complete).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(1)
    expect(h.api.complete).toHaveBeenCalledTimes(2)
    expect(h.api.complete.mock.calls[1][0].trigger).toBe('edit')
    h.destroy()
  })
  it.each([' recommendation', '推荐内容', ' élan 👩‍👩‍👧‍👦'])(
    'retains matching remainder for %s and undoes only the Tab part',
    async (completion) => {
      const h = interactive('Start', completion)
      await h.suggest()
      const first = [
        ...new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(completion)
      ][0].segment
      h.insert(first)
      expect(h.suggestion()).toBe(completion.slice(first.length))
      await vi.advanceTimersByTimeAsync(1_000)
      expect(h.api.complete).toHaveBeenCalledTimes(1)
      h.key('Tab')
      undo(h.view.state, h.view.dispatch)
      expect(h.view.state.doc.textContent).toBe(`Start${first}`)
      h.destroy()
    }
  )
  it('restarts normally when the entire suggestion is typed or input differs', async () => {
    const h = interactive('Start', ' next')
    await h.suggest()
    h.insert(' next')
    expect(h.suggestion()).toBeUndefined()
    await vi.advanceTimersByTimeAsync(600)
    expect(h.api.complete).toHaveBeenCalledTimes(2)
    h.insert(' mismatch')
    expect(h.suggestion()).toBeUndefined()
    await vi.advanceTimersByTimeAsync(600)
    expect(h.api.complete).toHaveBeenCalledTimes(3)
    h.destroy()
  })
  it('does not expose a dangling combining character or preserve pasted content', async () => {
    const h = interactive('Start', 'élan')
    await h.suggest()
    h.insert('e')
    expect(h.suggestion()).toBeUndefined()
    await vi.advanceTimersByTimeAsync(600)
    h.view.dispatch(h.view.state.tr.insertText('é').setMeta('uiEvent', 'paste'))
    expect(h.suggestion()).toBeUndefined()
    h.destroy()
  })
  it('keeps Esc suppression across focus, menus and metadata but releases it on cursor movement', async () => {
    const h = interactive()
    await h.suggest()
    h.key('Escape')
    h.event('blur')
    h.event('focus')
    h.host.blocked = true
    refreshAutocomplete(h.view)
    h.host.blocked = false
    refreshAutocomplete(h.view)
    h.view.dispatch(h.view.state.tr.setMeta('save-ack', true))
    await vi.advanceTimersByTimeAsync(1_000)
    expect(h.api.complete).toHaveBeenCalledTimes(1)
    h.move(h.view.state.selection.from - 1)
    await vi.advanceTimersByTimeAsync(600)
    expect(h.api.complete).toHaveBeenCalledTimes(2)
    h.destroy()
  })
  it('deduplicates focus/reset timers, preserves quiet failures and allows explicit style changes', async () => {
    const h = interactive()
    h.api.complete.mockImplementation(async (input) => ({
      requestId: input.requestId,
      generation: input.generation,
      status: 'empty',
      text: ''
    }))
    h.event('focus')
    refreshAutocomplete(h.view)
    h.event('focus')
    await vi.advanceTimersByTimeAsync(600)
    expect(h.api.complete).toHaveBeenCalledTimes(1)
    h.event('blur')
    h.event('focus')
    refreshAutocomplete(h.view)
    await vi.advanceTimersByTimeAsync(60_000)
    expect(h.api.complete).toHaveBeenCalledTimes(1)
    refreshAutocomplete(h.view, 'style')
    await vi.advanceTimersByTimeAsync(600)
    expect(h.api.complete).toHaveBeenCalledTimes(2)
    h.destroy()
  })
  it.each(['paused', 'cooldown'] as const)(
    'preserves %s across UI/style/toggle resets',
    async (status) => {
      const h = interactive()
      h.api.complete.mockImplementation(async (input) => ({
        requestId: input.requestId,
        generation: input.generation,
        status,
        text: '',
        retryAt: status === 'cooldown' ? Date.now() + 60_000 : undefined
      }))
      await h.suggest()
      for (const reason of ['ui', 'style', 'toggle'] as const) {
        refreshAutocomplete(h.view, reason)
        h.insert('x')
        await vi.advanceTimersByTimeAsync(600)
      }
      expect(h.api.complete).toHaveBeenCalledTimes(1)
      refreshAutocomplete(h.view, 'provider')
      await vi.advanceTimersByTimeAsync(600)
      expect(h.api.complete).toHaveBeenCalledTimes(2)
      h.destroy()
    }
  )
  it.each(['edit', 'blur', 'disabled', 'menu', 'destroy'] as const)(
    'rejects delayed results after %s',
    async (action) => {
      const h = interactive()
      const pending = Promise.withResolvers<AutocompleteResult>()
      h.api.complete.mockReturnValueOnce(pending.promise)
      h.event('focus')
      await vi.advanceTimersByTimeAsync(600)
      const input = h.api.complete.mock.calls[0][0]
      if (action === 'edit') h.insert('!')
      if (action === 'blur') {
        h.host.focused = false
        h.event('blur')
      }
      if (action === 'disabled') {
        h.host.enabled = false
        refreshAutocomplete(h.view, 'toggle')
      }
      if (action === 'menu') {
        h.host.blocked = true
        refreshAutocomplete(h.view)
      }
      if (action === 'destroy') h.destroy()
      pending.resolve({
        requestId: input.requestId,
        generation: input.generation,
        status: 'suggestion',
        text: 'stale'
      })
      await vi.advanceTimersByTimeAsync(1)
      expect(h.suggestion()).toBeUndefined()
      expect(h.api.cancel).toHaveBeenCalled()
      if (action !== 'destroy') h.destroy()
    }
  )
  it('compares committed Chinese after preedit settlement without matching pinyin', async () => {
    const h = interactive('这里', '推荐内容')
    await h.suggest()
    const start = h.view.state.selection.from
    h.host.composing = true
    h.event('compositionstart')
    h.insert('tuijian')
    expect(h.suggestion()).toBeUndefined()
    expect(h.key('Tab')).toBe(false)
    expect(h.key('Escape', { isComposing: true })).toBe(false)
    await vi.advanceTimersByTimeAsync(1_000)
    expect(h.api.complete).toHaveBeenCalledTimes(1)
    h.event('compositionend')
    await vi.advanceTimersByTimeAsync(20)
    h.view.dispatch(h.view.state.tr.insertText('推荐', start, start + 7))
    h.host.composing = false
    await vi.advanceTimersByTimeAsync(20)
    expect(h.suggestion()).toBe('内容')
    expect(h.api.complete).toHaveBeenCalledTimes(1)
    h.key('Tab')
    expect(h.view.state.doc.textContent).toBe('这里推荐内容')
    undo(h.view.state, h.view.dispatch)
    expect(h.view.state.doc.textContent).toBe('这里推荐')
    h.destroy()
  })
  it.each(['cancel', 'mismatch', 'blur', 'configuration'] as const)(
    'handles composition %s',
    async (action) => {
      const h = interactive('这里', '推荐内容')
      await h.suggest()
      const start = h.view.state.selection.from
      h.event('compositionstart')
      h.insert('tuijian')
      if (action === 'blur') {
        h.host.focused = false
        h.event('blur')
      }
      if (action === 'configuration') refreshAutocomplete(h.view, 'style')
      h.view.dispatch(
        h.view.state.tr.insertText(action === 'mismatch' ? '其他' : '', start, start + 7)
      )
      h.event('compositionend')
      await vi.advanceTimersByTimeAsync(20)
      expect(h.suggestion()).toBe(action === 'cancel' ? '推荐内容' : undefined)
      await vi.advanceTimersByTimeAsync(600)
      expect(h.api.complete).toHaveBeenCalledTimes(
        action === 'mismatch' || action === 'configuration' ? 2 : 1
      )
      h.destroy()
    }
  )
  it('resumes after a menu closes without a document or selection transaction', async () => {
    const h = interactive()
    await h.suggest()
    h.host.blocked = true
    h.view.dispatch(h.view.state.tr.setMeta('menu', true))
    expect(h.suggestion()).toBeUndefined()
    await vi.advanceTimersByTimeAsync(1_000)
    expect(h.api.complete).toHaveBeenCalledTimes(1)
    h.host.blocked = false
    h.view.dispatch(h.view.state.tr.setMeta('menu', false))
    await vi.advanceTimersByTimeAsync(600)
    expect(h.api.complete).toHaveBeenCalledTimes(2)
    h.destroy()
  })
  it('invalidates replaced selections and changed block structure', async () => {
    const h = interactive()
    await h.suggest()
    h.view.dispatch(h.view.state.tr.setSelection(TextSelection.create(h.view.state.doc, 3, 5)))
    expect(h.suggestion()).toBeUndefined()
    h.insert('Other')
    await vi.advanceTimersByTimeAsync(600)
    h.view.dispatch(
      h.view.state.tr.setNodeMarkup(
        h.view.state.selection.$from.before(),
        h.view.state.schema.nodes.heading,
        { level: 2 }
      )
    )
    expect(h.suggestion()).toBeUndefined()
    h.destroy()
  })
})
