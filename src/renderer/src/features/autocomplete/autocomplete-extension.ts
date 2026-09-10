import { createExtension, type ExtensionOptions } from '@blocknote/core'
import { SuggestionMenu } from '@blocknote/core/extensions'
import { closeHistory, isHistoryTransaction } from 'prosemirror-history'
import { Plugin, PluginKey, TextSelection, type EditorState } from 'prosemirror-state'
import { Decoration, DecorationSet, type EditorView } from 'prosemirror-view'
import type {
  AutocompleteApi,
  AutocompleteCancelReason,
  AutocompleteTrigger,
  AutocompleteRequest,
  AutocompleteResult
} from '../../../../shared/contracts/autocomplete'

export type AutocompleteStatus = 'idle' | 'loading' | AutocompleteResult['status']
type Context = Pick<AutocompleteRequest, 'blockId' | 'prefix' | 'suffix' | 'atBlockEnd'>
type Suggestion = {
  text: string
  position: number
  requestId: string
  document: EditorState['doc']
}
type RefreshReason = 'ui' | 'model' | 'provider' | 'style' | 'toggle'
type Change = { type: 'edit' | 'cursor' | 'history' } | { type: 'reset'; reason: RefreshReason }
type PluginState = { suggestion: Suggestion | null; revision: number; change?: Change }
export const autocompletePluginKey = new PluginKey<PluginState>('writellm-autocomplete')
const RESET = 'writellm-autocomplete-reset'
const eligible = new Set([
  'paragraph',
  'heading',
  'bulletListItem',
  'numberedListItem',
  'checkListItem'
])

export function autocompleteContext(state: EditorState): Context | null {
  if (!(state.selection instanceof TextSelection) || !state.selection.empty) return null
  const { $from } = state.selection
  if (!eligible.has($from.parent.type.name)) return null
  let blockId: string | undefined
  for (let depth = $from.depth; depth > 0; depth--) {
    const node = $from.node(depth)
    if (node.type.name.toLowerCase().includes('table')) return null
    if (blockId === undefined && typeof node.attrs.id === 'string') blockId = node.attrs.id
  }
  if (!blockId) return null
  const leafText = (node: EditorState['doc']): string =>
    node.type.name === 'hardBreak' ? '\n' : '[inline content]'
  const prefix = [...state.doc.textBetween(0, $from.pos, '\n', leafText)].slice(-8_000).join('')
  if (prefix.trim().length === 0) return null
  const atBlockEnd = $from.parentOffset === $from.parent.content.size
  const suffix = atBlockEnd
    ? ''
    : [...$from.parent.textBetween($from.parentOffset, $from.parent.content.size, '\n', leafText)]
        .slice(0, 2_000)
        .join('')
  return { blockId, prefix, suffix, atBlockEnd }
}

export function refreshAutocomplete(view: EditorView, reason: RefreshReason = 'ui'): void {
  view.dispatch(view.state.tr.setMeta(RESET, reason).setMeta('addToHistory', false))
}

// Compare actual documents, not DOM/input event data. Only one plain-text insertion at
// the original caret can consume a candidate; marks, structure and surrounding text must match.
export function consumeAutocomplete(
  suggestion: Suggestion,
  before: EditorState,
  after: EditorState
): Suggestion | null {
  if (
    suggestion.document !== before.doc ||
    !before.selection.empty ||
    before.selection.from !== suggestion.position ||
    !(after.selection instanceof TextSelection) ||
    !after.selection.empty
  )
    return null
  const size = after.doc.content.size - before.doc.content.size
  if (size <= 0 || after.selection.from !== suggestion.position + size) return null
  const inserted = after.doc.textBetween(
    suggestion.position,
    suggestion.position + size,
    '\n',
    '\ufffc'
  )
  if (
    inserted.length !== size ||
    !suggestion.text.startsWith(inserted) ||
    !before.tr.insertText(inserted, suggestion.position).doc.eq(after.doc)
  )
    return null
  const boundary = [
    ...new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(suggestion.text)
  ].some((part) => part.index + part.segment.length === inserted.length)
  if (!boundary) return null
  return {
    ...suggestion,
    text: suggestion.text.slice(inserted.length),
    position: after.selection.from,
    document: after.doc
  }
}

export const autocompleteExtension = createExtension(
  ({
    editor,
    options
  }: ExtensionOptions<{
    api: AutocompleteApi
    projectSessionId: string
    sectionId: string
    enabled(): boolean
    blocked(): boolean
    composing?(): boolean
    onStatus(status: AutocompleteStatus): void
    onError(error: unknown): void
  }>) => {
    let view: EditorView | undefined
    let timer: ReturnType<typeof setTimeout> | undefined
    let pendingId: string | undefined
    let receiptId: string | undefined
    let generation = 0
    let destroyed = false
    let previouslyBlocked = false
    let accepting = false
    let composing = false
    let settling = false
    let settlementDeadline = 0
    let held: { suggestion: Suggestion | null; state: EditorState } | undefined
    let quiet: { doc: EditorState['doc']; selection: EditorState['selection'] } | undefined
    let paused = false
    let retryAt = 0
    const currentSuggestion = () => view && autocompletePluginKey.getState(view.state)?.suggestion
    const blocked = () =>
      !!editor.getExtension(SuggestionMenu)?.store.state?.show || options.blocked()
    const isQuiet = () =>
      !!view && quiet?.doc.eq(view.state.doc) && quiet.selection.eq(view.state.selection)
    const allowed = () =>
      !!view &&
      !destroyed &&
      view.editable &&
      view.hasFocus() &&
      !view.composing &&
      !options.composing?.() &&
      !composing &&
      !settling &&
      options.enabled() &&
      !blocked()
    const stopTimer = () => {
      if (timer !== undefined) clearTimeout(timer)
      timer = undefined
    }
    const paint = (suggestion: Suggestion | null) => {
      if (view && !destroyed)
        view.dispatch(
          view.state.tr.setMeta(autocompletePluginKey, suggestion).setMeta('addToHistory', false)
        )
    }
    const invalidate = (reason: AutocompleteCancelReason, keepReceipt = false) => {
      generation++
      stopTimer()
      const ids = new Set([pendingId, keepReceipt ? undefined : receiptId])
      pendingId = undefined
      if (!keepReceipt) receiptId = undefined
      for (const requestId of ids)
        if (requestId) {
          void options.api
            .cancel({ projectSessionId: options.projectSessionId, requestId, reason })
            .catch(options.onError)
        }
    }
    const discardComposition = () => {
      held = undefined
      composing = false
      settling = false
    }
    const suppress = () => {
      if (view) quiet = { doc: view.state.doc, selection: view.state.selection }
    }
    const schedule = (trigger: AutocompleteTrigger, delay = 600) => {
      stopTimer()
      if (
        !view ||
        destroyed ||
        !options.enabled() ||
        paused ||
        Date.now() < retryAt ||
        accepting ||
        composing ||
        settling ||
        currentSuggestion() ||
        isQuiet()
      )
        return
      timer = setTimeout(() => {
        timer = undefined
        void complete(trigger)
      }, delay)
    }
    const complete = async (trigger: AutocompleteTrigger): Promise<void> => {
      if (
        !view ||
        !allowed() ||
        isQuiet() ||
        pendingId ||
        currentSuggestion() ||
        paused ||
        Date.now() < retryAt
      )
        return
      const context = autocompleteContext(view.state)
      if (!context) return
      const stamp = generation
      const document = view.state.doc
      const selection = view.state.selection
      const id = crypto.randomUUID()
      pendingId = id
      options.onStatus('loading')
      try {
        const result = await options.api.complete({
          ...context,
          trigger,
          requestId: id,
          generation: stamp,
          projectSessionId: options.projectSessionId,
          sectionId: options.sectionId
        })
        if (
          destroyed ||
          !view ||
          generation !== stamp ||
          pendingId !== id ||
          result.requestId !== id ||
          result.generation !== stamp ||
          view.state.doc !== document ||
          !view.state.selection.eq(selection) ||
          !allowed()
        )
          return
        pendingId = undefined
        paused = result.status === 'paused'
        retryAt = result.retryAt ?? 0
        options.onStatus(result.status)
        if (result.status === 'suggestion' && result.text) {
          receiptId = id
          paint({ text: result.text, position: selection.from, requestId: id, document })
        } else suppress()
      } catch (err) {
        options.onError(err)
        if (!destroyed && generation === stamp) {
          pendingId = undefined
          suppress()
          options.onStatus('failed')
        }
      }
    }
    const settleComposition = () => {
      stopTimer()
      if (!settling || destroyed) return
      timer = setTimeout(() => {
        timer = undefined
        if (!view || destroyed || !settling) return
        if (view.composing || options.composing?.()) {
          if (Date.now() < settlementDeadline) settleComposition()
          else {
            discardComposition()
            invalidate('composition')
          }
          return
        }
        const snapshot = held
        held = undefined
        settling = false
        if (!allowed()) {
          invalidate('composition')
          return
        }
        const unchanged =
          snapshot?.state.doc.eq(view.state.doc) &&
          snapshot.state.selection.eq(view.state.selection)
        const next = snapshot?.suggestion
          ? unchanged
            ? { ...snapshot.suggestion, document: view.state.doc }
            : consumeAutocomplete(snapshot.suggestion, snapshot.state, view.state)
          : null
        if (!unchanged) quiet = undefined
        if (next?.text) {
          paint(next)
          options.onStatus('suggestion')
        } else {
          invalidate('composition')
          options.onStatus('idle')
          schedule('composition')
        }
      }, 20)
    }
    const plugin = new Plugin<PluginState>({
      key: autocompletePluginKey,
      state: {
        init: () => ({ suggestion: null, revision: 0 }),
        apply(transaction, state, oldState, newState) {
          const reason = transaction.getMeta(RESET) as RefreshReason | undefined
          if (reason)
            return {
              suggestion: null,
              revision: state.revision + 1,
              change: { type: 'reset', reason }
            }
          const painted = transaction.getMeta(autocompletePluginKey) as
            | Suggestion
            | null
            | undefined
          if (painted !== undefined) return { ...state, suggestion: painted }
          const appended = transaction.getMeta('appendedTransaction')
          if (isHistoryTransaction(transaction) || (appended && isHistoryTransaction(appended)))
            return { suggestion: null, revision: state.revision + 1, change: { type: 'history' } }
          if (transaction.docChanged || !oldState.selection.eq(newState.selection)) {
            const candidate =
              state.suggestion &&
              !composing &&
              !settling &&
              !accepting &&
              !['paste', 'drop'].includes(transaction.getMeta('uiEvent'))
                ? consumeAutocomplete(state.suggestion, oldState, newState)
                : null
            return {
              suggestion: candidate?.text ? candidate : null,
              revision: state.revision + 1,
              change: { type: transaction.docChanged ? 'edit' : 'cursor' }
            }
          }
          return state
        }
      },
      props: {
        decorations(state) {
          const suggestion = autocompletePluginKey.getState(state)?.suggestion
          if (!suggestion) return null
          return DecorationSet.create(state.doc, [
            Decoration.widget(
              suggestion.position,
              () => {
                const element = document.createElement('span')
                element.textContent = suggestion.text
                element.className =
                  'pointer-events-none select-none whitespace-pre-wrap text-muted-foreground'
                element.setAttribute('data-autocomplete-suggestion', '')
                element.setAttribute('aria-hidden', 'true')
                element.contentEditable = 'false'
                return element
              },
              {
                side: 1,
                key: `${suggestion.requestId}:${suggestion.position}`,
                ignoreSelection: true
              }
            )
          ])
        },
        handleDOMEvents: {
          focus() {
            invalidate('blur')
            schedule('focus')
            return false
          },
          blur() {
            discardComposition()
            invalidate('blur')
            paint(null)
            options.onStatus('idle')
            return false
          },
          compositionstart() {
            if (!view) return false
            held = { suggestion: currentSuggestion() ?? null, state: view.state }
            composing = true
            settling = false
            invalidate('composition', true)
            paint(null)
            options.onStatus('idle')
            return false
          },
          compositionend() {
            composing = false
            settling = true
            settlementDeadline = Date.now() + 1_000
            settleComposition()
            return false
          },
          keydown(currentView, event) {
            if (event.isComposing || event.keyCode === 229 || !allowed()) return false
            const suggestion = currentSuggestion()
            if (event.key === 'Escape') {
              const handled = !!suggestion || !!pendingId || timer !== undefined
              invalidate('dismiss')
              paint(null)
              suppress()
              options.onStatus('idle')
              if (handled) event.preventDefault()
              return handled
            }
            if (
              event.key !== 'Tab' ||
              event.shiftKey ||
              event.altKey ||
              event.metaKey ||
              event.ctrlKey ||
              !suggestion ||
              suggestion.document !== currentView.state.doc ||
              !(currentView.state.selection instanceof TextSelection) ||
              !currentView.state.selection.empty ||
              suggestion.position !== currentView.state.selection.from
            )
              return false
            event.preventDefault()
            if (event.repeat) return true
            accepting = true
            receiptId = undefined
            invalidate('consumed')
            quiet = undefined
            void options.api
              .accepted({
                projectSessionId: options.projectSessionId,
                requestId: suggestion.requestId
              })
              .catch(options.onError)
            currentView.dispatch(
              closeHistory(currentView.state.tr)
                .insertText(suggestion.text, suggestion.position)
                .setMeta(autocompletePluginKey, null)
            )
            currentView.dispatch(closeHistory(currentView.state.tr))
            accepting = false
            options.onStatus('idle')
            schedule('accept', 200)
            return true
          }
        }
      },
      view(initialView) {
        view = initialView
        destroyed = false
        return {
          update(currentView, previous) {
            view = currentView
            const state = autocompletePluginKey.getState(currentView.state)
            const old = autocompletePluginKey.getState(previous)
            if (state && state.revision !== old?.revision) {
              const change = state.change
              if (change?.type === 'reset') {
                discardComposition()
                invalidate('configuration')
                if (change.reason !== 'ui') quiet = undefined
                if (change.reason === 'model' || change.reason === 'provider') {
                  paused = false
                  retryAt = 0
                }
                options.onStatus(paused ? 'paused' : Date.now() < retryAt ? 'cooldown' : 'idle')
                schedule('configuration')
              } else if (change?.type === 'history') {
                discardComposition()
                invalidate('history')
                suppress()
                options.onStatus('idle')
              } else if (composing || settling) {
                if (settling) settleComposition()
              } else if (change) {
                quiet = undefined
                invalidate(change.type, !!state.suggestion)
                options.onStatus(state.suggestion ? 'suggestion' : 'idle')
                if (!state.suggestion && !accepting) schedule(change.type)
              }
            }
            // Menu state can change independently of the document (e.g. slash menu).
            if (
              (!currentView.editable || !options.enabled() || blocked()) &&
              !composing &&
              !settling
            ) {
              previouslyBlocked = true
              if (timer !== undefined || pendingId || receiptId) {
                discardComposition()
                invalidate('menu')
                if (currentSuggestion()) paint(null)
              }
            } else if (previouslyBlocked && !composing && !settling) {
              previouslyBlocked = false
              schedule('focus')
            }
          },
          destroy() {
            discardComposition()
            invalidate('destroy')
            destroyed = true
            view = undefined
          }
        }
      }
    })
    return { key: 'writellmAutocomplete', prosemirrorPlugins: [plugin] }
  }
)
