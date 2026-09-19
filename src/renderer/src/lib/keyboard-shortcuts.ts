type ShortcutDefinition = {
  key: string
  shift?: boolean
  alt?: boolean
  repeat?: boolean
  action: string
  context: string
  group: 'Application' | 'Editor'
}

export const applicationShortcuts = {
  newProject: { key: 'n', action: 'New project', context: 'No project open', group: 'Application' },
  openProject: {
    key: 'o',
    action: 'Open project',
    context: 'No project open',
    group: 'Application'
  },
  save: {
    key: 's',
    action: 'Save current section',
    context: 'Active project',
    group: 'Application'
  },
  settings: { key: ',', action: 'Open Settings', context: 'Anywhere', group: 'Application' },
  find: { key: 'f', action: 'Find in manuscript', context: 'Active project', group: 'Application' },
  quickActions: {
    key: 'k',
    shift: true,
    action: 'Open selection quick actions',
    context: 'Selected editor text',
    group: 'Editor'
  },
  comment: {
    key: 'm',
    alt: true,
    action: 'Add comment',
    context: 'Selected editor text outside tables, formulas, and diagrams',
    group: 'Editor'
  },
  previousSection: {
    key: 'ArrowUp',
    alt: true,
    repeat: true,
    action: 'Go to previous section',
    context: 'Active project with a previous section',
    group: 'Application'
  },
  nextSection: {
    key: 'ArrowDown',
    alt: true,
    repeat: true,
    action: 'Go to next section',
    context: 'Active project with a next section',
    group: 'Application'
  }
} as const satisfies Record<string, ShortcutDefinition>

export type ApplicationShortcutId = keyof typeof applicationShortcuts

type ShortcutEvent = Pick<
  KeyboardEvent,
  | 'key'
  | 'code'
  | 'ctrlKey'
  | 'metaKey'
  | 'shiftKey'
  | 'altKey'
  | 'defaultPrevented'
  | 'isComposing'
  | 'keyCode'
  | 'repeat'
>

export function matchesShortcut(event: ShortcutEvent, id: ApplicationShortcutId): boolean {
  const shortcut: ShortcutDefinition = applicationShortcuts[id]
  if (event.defaultPrevented || event.isComposing || event.keyCode === 229) return false
  if (event.repeat && !shortcut.repeat) return false
  if (event.ctrlKey === event.metaKey) return false
  if (event.shiftKey !== !!shortcut.shift || event.altKey !== !!shortcut.alt) return false
  // Option-letter combinations on macOS can report a symbol instead of the letter.
  return (
    event.key.toLowerCase() === shortcut.key.toLowerCase() ||
    (!!shortcut.alt &&
      /^[a-z]$/.test(shortcut.key) &&
      event.code === `Key${shortcut.key.toUpperCase()}`)
  )
}

export function shortcutLabel(id: ApplicationShortcutId): string {
  const shortcut: ShortcutDefinition = applicationShortcuts[id]
  const key =
    shortcut.key === 'ArrowUp'
      ? '↑'
      : shortcut.key === 'ArrowDown'
        ? '↓'
        : shortcut.key.toUpperCase()
  return `${shortcut.shift ? '⇧ + ' : ''}⌘ / Ctrl + ${shortcut.alt ? '⌥ / Alt + ' : ''}${key}`
}

export const keyboardShortcuts = [
  ...Object.entries(applicationShortcuts).map(([id, shortcut]) => ({
    action: shortcut.action,
    context: shortcut.context,
    group: shortcut.group,
    shortcut: shortcutLabel(id as ApplicationShortcutId)
  })),
  {
    action: 'Bold / Italic / Underline',
    shortcut: '⌘ / Ctrl + B / I / U',
    context: 'Focused manuscript editor',
    group: 'Editor'
  },
  {
    action: 'Undo / Redo',
    shortcut: '⌘ / Ctrl + Z / ⇧ + Z',
    context: 'Focused manuscript editor',
    group: 'Editor'
  },
  {
    action: 'Accept autocomplete',
    shortcut: 'Tab',
    context: 'Current autocomplete suggestion visible',
    group: 'Editor'
  },
  {
    action: 'Dismiss autocomplete',
    shortcut: 'Esc',
    context: 'Autocomplete pending or visible',
    group: 'Editor'
  },
  {
    action: 'Send message / Queue follow-up',
    shortcut: 'Enter',
    context: 'Agent composer; queues a follow-up while running',
    group: 'Agent input'
  },
  {
    action: 'Insert newline',
    shortcut: 'Shift + Enter',
    context: 'Agent composer',
    group: 'Agent input'
  },
  {
    action: 'Steer running Agent',
    shortcut: '⌘ / Ctrl + Enter',
    context: 'Agent composer while running; sends normally when idle',
    group: 'Agent input'
  },
  {
    action: 'Submit message edit',
    shortcut: '⌘ / Ctrl + Enter',
    context: 'Editing an Agent message',
    group: 'Agent input'
  }
] as const
