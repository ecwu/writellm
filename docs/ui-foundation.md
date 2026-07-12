# UI foundation

Renderer consumers import primitives from `@/components/ui/<name>`, business-neutral compositions from `@/components/patterns/<name>`, and appearance state only through `useAppearance`. Dependencies flow from features/provider to patterns to primitives to Base UI or native elements. Primitives and patterns never consume IPC; only `AppearanceProvider` consumes `window.writellmAppearance`.

The public inventory is Button, Input, Label, Card, Alert, Badge, Separator, Dialog, Tooltip, ScrollArea, and Select; patterns are FormField, StatusNotice, EmptyState, and AppearanceControls. These cover the accepted ten 002 needs: actions, icon discoverability, labeled fields, surfaces, separators, scrolling, modal behavior, status feedback, state badges, and empty states.

Customize in this order: compose existing components, select an existing named variant, then add feature-local layout using semantic tokens. Do not add raw palette values, arbitrary z-index scales, direct Base UI imports, or copied primitives.

## Extension requests

A `FoundationExtensionRequest` records the accepted consuming feature, unmet user need, proposed primitive/pattern/variant, state matrix, accessibility and theme impact, owner, dependencies/bundle effect, and DOM plus Electron verification plan.

## Pinned upgrade workflow

Use the exact CLI version recorded in `package.json`/history and update one component group at a time. Generate into a review branch, eject upstream CSS to `src/renderer/theme/shadcn.css`, and remove the CLI dependency. Review dependency/lockfile, source, public props, DOM/focus semantics, token use, and consumer/runtime tests before accepting the diff. Never overwrite project-owned modifications blindly.
