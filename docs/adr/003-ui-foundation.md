# ADR-003: Source-owned renderer UI and appearance foundation

- Status: Accepted — maintainer accepted through design Q&A on 2026-07-12
- Date: 2026-07-12
- Owners: WriteLLM v2 maintainers
- Scope: Cross-feature renderer components, styling/tokens, Typeset, application appearance preferences, minimal IPC, accessibility and upgrade rules

## Context

`001-project-foundation` is accepted and implemented. Its launch page currently uses semantic React markup plus handwritten global CSS and component-like class names. `002-workspace-shell` is designed but not implemented; its Draft research leaves overlay/focus, design-system and test-harness choices unresolved. Later features will add editor, sources, provider settings, AI review and history UI.

Without a shared foundation, each renderer feature can create its own buttons, fields, surfaces, overlays, focus behavior and colors. That would make 001 migration risky, create accessibility drift and force 002 or later features to own cross-cutting UI decisions. The user has selected shadcn/ui style and component conventions for WriteLLM v2.

The maintainer also requires runtime System/Light/Dark selection and a typography foundation suitable for an editor. This decision therefore adds one narrowly scoped application-preference boundary while leaving project/recent storage and document content unchanged.

## Decision

### 1. Use the shadcn source-owned model

WriteLLM will use shadcn as a source generator and convention, not as an opaque hosted component service. Generated component source lives in `src/renderer/components/ui`, is committed to the repository and becomes WriteLLM-owned code. A reviewed Rhea + Base UI preset initializes the existing Vite project, and `components.json` records CLI generation settings, CSS and aliases.

The CLI is implementation tooling and may fetch official registry items only at generation/update time. After generating the approved components, WriteLLM runs the same pinned CLI's `eject` flow so `shadcn/tailwind.css` is inlined and the `shadcn` package is removed. Production must build and run offline without registry access. A project-owned remote/private registry or separately published design-system package is not created while there is only one renderer consumer.

### 2. Use Tailwind CSS v4 and semantic CSS variables

The renderer will use Tailwind CSS v4 through the Vite integration expected by current shadcn. Theme values use semantic CSS variables rather than feature palette names or repeated literal colors. Light and dark token sets are defined centrally; features consume semantic utilities and may use utilities for local layout. Forced-colors/high-contrast mode keeps browser adjustment enabled by default and uses system-color focus/boundary overrides only where runtime evidence requires them.

The initial visual preset is Rhea with a neutral base because it is a compact shadcn product-interface style suited to a desktop writing workspace. Brand adjustments happen through semantic tokens and reviewed variants, not by forking primitives.

### 3. Use the Base UI variant

The foundation will generate shadcn's Base UI component variants. Base UI is the current shadcn default/recommendation for new projects and WriteLLM has no legacy primitive investment. Feature code does not import Base UI directly; `components/ui` is the adapter and ownership boundary.

Changing primitive base later is an ADR-level migration because it can alter DOM, focus, dismissal and state semantics even when high-level component names remain similar.

### 4. Persist System/Light/Dark as a main-owned application preference

Theme mode is `system | light | dark`, defaults to `system`, and persists in a versioned, atomically replaced `appearance-preferences.json` under main-owned userData. Main validates disk data and renderer updates, reads the preference before BrowserWindow creation, and sets `nativeTheme.themeSource` so the first frame uses the effective theme. Missing storage uses defaults; corrupt, unknown-version or invalid storage falls back in memory with a safe warning and is not overwritten until a valid update succeeds.

The accepted six-method `window.writellm` project bridge remains exact. Appearance uses a separate `window.writellmAppearance` namespace with only `getAppearancePreferences` and `updateAppearancePreferences`. Renderer receives normalized DTOs, never paths, files, nativeTheme, generic IPC or generic settings access. Preferences are application-global and never enter project files or document/export semantics.

Reduced motion and forced colors remain system-derived. Explicit Light/Dark is not overridden by OS color changes; System follows them.

### 5. Separate primitives, patterns and feature composition

- `components/ui`: minimal primitives, their variants, semantic styling and accessibility defaults.
- `components/patterns`: business-neutral controlled compositions such as FormField, StatusNotice, EmptyState and AppearanceControls.
- `appearance`: provider/state wiring that alone consumes the separate appearance bridge.
- feature directories: copy, layout, business state, validation, async behavior, IPC calls and policy.

Imports flow `feature/appearance provider → patterns → ui → Base UI/native`. UI primitives and patterns never read IPC; shared layers never import project/workspace state.

The initial inventory is limited to Button, Input, Label, Card, Alert, Badge, Separator, Dialog, Tooltip, ScrollArea and Select plus four patterns above. Other catalog items are added only for accepted feature needs.

### 6. Use source-owned shadcn/typeset for rendered prose

WriteLLM adopts the July 2026 shadcn/typeset system as a project-owned `typeset.css`, not a runtime package. The foundation defines `typeset-editor`, `typeset-reading` and `typeset-compact` using body, heading, mono, size, leading and flow variables. Editor is 16px/1.75/1.25em, reading is 18px/1.9/2em, and compact is 14px/1.6/1em.

UI stays on Rhea's system sans stack. Editor body/headings default to an audited system serif stack and code to system mono; user preferences may select only reviewed font IDs and numeric values within accepted bounds. 011 does not enumerate installed fonts, download remote fonts, accept arbitrary family strings or import font files.

Typeset owns prose rhythm, theme integration, opt-out and append-stable streaming styles. Layout owns measure. It never mutates HTML/Markdown, editor state, project files or exports.

### 7. Make accessibility a WriteLLM contract

Generated primitives are not accepted solely because their upstream library claims accessibility. WriteLLM verifies native roles/names, keyboard behavior, visible focus, disabled/invalid states, dialog focus containment/return and inert background, tooltip keyboard discovery, non-color status meaning, light/dark states and reduced motion in its actual compositions.

Complex DOM/focus behavior is covered both in renderer DOM tests and compiled Electron runtime checks. Static types and snapshots cannot replace those tests.

The runtime check is a dedicated compiled UI fixture and Electron test entry, not the current lifecycle-only smoke script. It uses native Electron keyboard input and DOM inspection plus deterministic theme/media emulation, while remaining outside product main/preload.

### 8. Control customization and upgrades

Consumers first compose, then use an existing named variant, then use feature-local semantic layout. A shared variant/pattern/primitive requires evidence of an accepted feature need, state matrix, accessibility/theme impact, owner and verification.

Feature-local copies of primitives, direct Base UI imports, parallel theme systems, raw palette values where semantic tokens exist, arbitrary z-index scales and blind generated overwrites are prohibited without architecture review.

Each shadcn update uses an exact reviewed version, one logical component group at a time. Maintainers inspect source, dependency/lockfile, DOM, public props, token and test changes. Generated output never has authority to discard local modifications.

### 9. Preserve 001 and precede 002

011 migrates the presentation of the current 001 launch page and adds only a lightweight theme selector. It must not alter `LaunchState`, the accepted six-method project bridge, project main/preload/shared contracts, user-facing project action meaning, recent behavior, error redaction or project filesystem effects. Appearance storage/IPC is isolated from project channels, DTOs, repositories and files. Existing 001 automated and quickstart results remain the compatibility gate.

Implementation order is:

1. keep 001 accepted implementation as baseline;
2. accept and implement 011, including launch migration/regression;
3. align and accept 002's still-Draft design against this foundation;
4. implement 002 and later renderer features using the shared contract.

## Consequences

### Positive

- 001 proves the foundation against real accepted behavior before 002 depends on it.
- Renderer features share tokens, focus behavior and component ownership without a separate package/release process.
- Base UI and generated source handle difficult primitives while WriteLLM retains review/control.
- Users can choose and persist System/Light/Dark without project coupling or first-frame theme flash.
- Typeset gives editor, reading and compact contexts one source-owned prose rhythm with streaming stability.
- Demand-driven inventory limits bundle and maintenance scope.

### Negative

- Tailwind, Base UI and generated utilities add dependencies to a previously minimal renderer.
- Source ownership means WriteLLM must review and maintain generated code instead of receiving opaque package updates.
- Rhea/Base UI becomes a durable choice; changing either later requires migration and broad regression testing.
- DOM testing setup and Electron UI smoke add test surface.
- Appearance preferences add a small durable schema, repository and two-method IPC surface that must be maintained.
- System-safe font stacks are intentionally less flexible than arbitrary local/imported fonts in the first version.

### Risks and mitigations

- **Generated code drift**: exact CLI versions, one-group updates and diff review.
- **Feature overrides erode consistency**: semantic tokens, finite variants and extension review.
- **Upstream accessibility regression**: project-owned DOM and Electron behavior tests.
- **Bundle growth**: initial inventory cap and build delta audit.
- **001 behavior regression**: presentation-only mapping and complete existing test/quickstart gate.
- **Appearance corruption or injection**: main validation, finite bounds, audited font IDs, atomic writes and safe fallback.
- **Theme flash or drift**: load before window creation, set nativeTheme, and test first paint plus runtime/restart changes.
- **Typeset drift**: committed CSS, three named presets and content/streaming regression fixtures.

## Alternatives considered

### Continue handwritten CSS and components

Rejected because it preserves today's minimal dependencies but does not solve cross-feature component, token, focus or upgrade consistency.

### Install a packaged component library without source ownership

Rejected because it makes deep product customization and incremental component review depend on an external public API and conflicts with the requested shadcn component model.

### Use Radix as the shadcn base

Viable and mature, but not selected for a new foundation because shadcn currently defaults to and recommends stable Base UI for new projects. Radix remains an alternative only if compatibility testing finds a blocking Base UI issue before ADR acceptance.

### Build a separate UI package or registry

Rejected for now because one renderer is the only consumer. Repository directories and import rules provide the necessary boundary with less process/build complexity.

### Store appearance in renderer localStorage

Rejected because it provides no main validation or atomic/versioned owner and cannot reliably set Electron's effective theme before BrowserWindow creation.

### Allow arbitrary local or uploaded fonts immediately

Rejected because enumeration, permissions, parsing, licensing and project portability are separate product/security decisions. Reviewed system stacks satisfy the accepted first version and keep the model extensible.

### Continue with hand-written Typography examples

Rejected because shadcn/typeset now provides a source-owned, container-aware and streaming-stable prose layer without a runtime package.

## Relationship to other ADRs and features

- ADR-002 and `001-project-foundation` remain authoritative for project/recent storage, native dialogs and project IPC. This ADR does not amend them.
- ADR-001 governs later content/Git storage and is unrelated to UI theme/component ownership; its subsequent acceptance does not change this ADR.
- `002-workspace-shell` must consume this ADR after acceptance and remove its own unresolved parallel design-system choice before implementation.

## Acceptance checklist before implementation

- [x] `specs/011-ui-foundation/spec.md`, plan and UI contract are Accepted.
- [x] Tailwind v4, semantic CSS variables, Base UI and Rhea/neutral are accepted.
- [x] Generation-time registry access followed by pinned `shadcn eject`, with no production `shadcn` dependency, is accepted.
- [x] System/Light/Dark, main-owned versioned persistence and the separate two-method appearance bridge are accepted.
- [x] Source-owned shadcn/typeset, three presets, audited system font IDs and bounded rhythm preferences are accepted.
- [x] The initial 11 primitives, 4 patterns and extension/upgrade rules are accepted.
- [x] Happy DOM/Testing Library plus the dedicated compiled Electron UI fixture/harness are accepted.
- [x] The 001 → 011 → 002 implementation order is accepted.
- [x] Future tasks must pin exact dependencies/CLI and include 001, appearance storage/IPC, DOM and compiled Electron regression gates.
