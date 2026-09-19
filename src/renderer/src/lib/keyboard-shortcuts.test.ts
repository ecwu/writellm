import { describe, expect, it } from 'vitest'
import {
  applicationShortcuts,
  matchesShortcut,
  shortcutLabel,
  type ApplicationShortcutId
} from './keyboard-shortcuts'

const event = {
  key: 's',
  code: 'KeyS',
  ctrlKey: true,
  metaKey: false,
  shiftKey: false,
  altKey: false,
  defaultPrevented: false,
  isComposing: false,
  keyCode: 83,
  repeat: false
}

describe('application shortcuts', () => {
  it.each(Object.keys(applicationShortcuts) as ApplicationShortcutId[])(
    'matches only the modifiers declared for %s',
    (id) => {
      const definition = applicationShortcuts[id]
      const input = {
        ...event,
        key: definition.key,
        code: '',
        shiftKey: 'shift' in definition,
        altKey: 'alt' in definition
      }
      expect(matchesShortcut(input, id)).toBe(true)
      expect(matchesShortcut({ ...input, ctrlKey: false, metaKey: true }, id)).toBe(true)
      expect(matchesShortcut({ ...input, key: input.key.toUpperCase() }, id)).toBe(true)
      expect(matchesShortcut({ ...input, shiftKey: !input.shiftKey }, id)).toBe(false)
      expect(matchesShortcut({ ...input, altKey: !input.altKey }, id)).toBe(false)
      expect(matchesShortcut({ ...input, metaKey: true }, id)).toBe(false)
      expect(matchesShortcut({ ...input, ctrlKey: false }, id)).toBe(false)
      expect(matchesShortcut({ ...input, key: 'unrelated' }, id)).toBe(false)
    }
  )

  it.each([{ defaultPrevented: true }, { isComposing: true }, { keyCode: 229 }, { repeat: true }])(
    'ignores consumed, composing, and repeated command events: %j',
    (override) => {
      expect(matchesShortcut({ ...event, ...override }, 'save')).toBe(false)
    }
  )

  it('allows repeating section navigation, but requires its exact modifiers', () => {
    expect(
      matchesShortcut({ ...event, key: 'ArrowDown', altKey: true, repeat: true }, 'nextSection')
    ).toBe(true)
    expect(
      matchesShortcut(
        { ...event, key: 'ArrowDown', altKey: true, shiftKey: true, repeat: true },
        'nextSection'
      )
    ).toBe(false)
  })

  it('recognizes Option-letter symbols on macOS without broadening other bindings', () => {
    const optionM = {
      ...event,
      ctrlKey: false,
      metaKey: true,
      altKey: true,
      key: 'µ',
      code: 'KeyM'
    }
    expect(matchesShortcut(optionM, 'comment')).toBe(true)
    expect(matchesShortcut({ ...optionM, shiftKey: true }, 'comment')).toBe(false)
    expect(matchesShortcut({ ...optionM, code: 'KeyB' }, 'comment')).toBe(false)
  })

  it.each(['b', 'B', 'j', 'J'])(
    'leaves %s and its modifier variants to the focused control',
    (key) => {
      for (const id of Object.keys(applicationShortcuts) as ApplicationShortcutId[]) {
        for (const shiftKey of [false, true]) {
          for (const altKey of [false, true]) {
            expect(
              matchesShortcut(
                { ...event, key, code: `Key${key.toUpperCase()}`, shiftKey, altKey },
                id
              )
            ).toBe(false)
          }
        }
      }
    }
  )

  it('derives displayed modifiers and keys from the command definition', () => {
    expect(shortcutLabel('save')).toBe('⌘ / Ctrl + S')
    expect(shortcutLabel('quickActions')).toBe('⇧ + ⌘ / Ctrl + K')
    expect(shortcutLabel('comment')).toBe('⌘ / Ctrl + ⌥ / Alt + M')
    expect(shortcutLabel('nextSection')).toBe('⌘ / Ctrl + ⌥ / Alt + ↓')
  })
})
