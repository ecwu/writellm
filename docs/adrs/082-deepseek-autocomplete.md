# ADR 082: DeepSeek editor autocomplete

Status: accepted
Date: 2026-09-10

## Decision

The user authorized a DeepSeek FIM/Chat Prefix proof of concept. Autocomplete is an
ephemeral editor capability, independent of Agent conversations, tools, jobs and traces.
The current project session starts disabled; a fixed editor toolbar toggle enables it.
The application-global Default Models settings section stores an explicit autocomplete
model reference in existing app_settings. There is no inherited Agent default.

Only the enabled built-in DeepSeek provider supplies credentials. A dedicated capability
catalog selects the completion model independently of Agent model enablement. Main reuses
the bound credential store without copying secrets or changing Agent endpoints. The narrow
DeepSeek adapter uses the fixed official beta endpoint in the existing background-worker.
This purpose-specific HTTP adapter is an explicit addition to the transport baseline; Pi
continues to own Agent generation. Embedding, rerank and image configuration migrations
are deferred, as are custom completion providers and additional Worker roles.

At a text block's structural end, use Chat Prefix with thinking disabled; otherwise use
FIM with that block's suffix. Later blocks do not affect routing. Context is the live draft's
nearest preceding chapter text and current prefix (8,000 Unicode characters), plus at most
2,000 suffix characters. No Agent history or retrieval is included. Paragraphs, headings
and list text are eligible; tables, code, formulas and media editing are excluded.

Requests debounce 600ms, allow one in flight, time out after 10 seconds and never retry
automatically. Generation is non-streaming, limited to 128 tokens at temperature 0.2 and
the first line. A length finish may produce a bounded suggestion, unlike Agent completion.
401/403 suspend until configuration changes; 429 observes at least 30 seconds of cooldown.
Project capability, request identity and draft generation reject stale results. Disabling,
editing, selection changes, blur, configuration changes and project close revoke requests.

Ghost text is a ProseMirror decoration, excluded from revisions, saves and exports. Tab
acceptance is one ordinary undoable text insertion, with IME and menus taking precedence.
Only safe lifecycle metadata, duration and usage enter structured logs; draft and generated
content remain ephemeral. Renderer IPC and Worker messages use bounded Zod contracts and
explicit correlation. Existing app_settings needs no migration or project schema change.

## Alternatives and consequences

An Agent run would add inappropriate persistence, tools and retry behavior to disposable
typing suggestions. Inheriting the Agent model couples latency and capability requirements.
FIM alone would cover both positions, but the user explicitly chose block-aware automatic
FIM/Chat Prefix routing. A generic provider configuration redesign is unnecessary for this
PoC; the separate purpose reference leaves room for future model defaults.

Verification includes focused settings/IPC/adapter/editor tests, real Electron interactions,
packaged Worker smoke, and a live-provider probe when credentials are available. Delivery
results belong in current-plan and the append-only implementation history.

The existing transitive prosemirror-history 1.5.0 is declared directly to use its public
closeHistory API before and after acceptance. No new resolved package version is added.

## 2026-09-10 amendment: completion style

The user authorized replacing the toolbar toggle with one shadcn dropdown containing
an enable checkbox, word/sentence/paragraph radio choices and the model settings entry.
The trigger always identifies both enablement and the selected style, including when off.
Style is an independent global app_settings preference, defaulting to word; enablement
remains project-session-only and starts off. No schema migration is required.

This supersedes the fixed 128-token policy: word uses 32 tokens and at most four words /
24 Unicode code points; sentence uses 128 tokens and one sentence / 160 code points;
paragraph uses 384 tokens and three sentences / 480 code points. All stop at the first
explicit line break. Sentence and paragraph continue the current unit without inserting
new blocks. Locale-aware segmentation and grapheme-safe caps enforce display limits in
the adapter, preserve leading spacing, and never manufacture punctuation. Chat Prefix
instructions reflect the style; FIM receives unmodified prefix/suffix text.

Main resolves the persisted style for each Worker request. Changing style cancels requests
and invalidates decorations, but does not clear authorization suspension or rate cooldown.
The menu blocks autocomplete while open. Safe lifecycle metadata includes style and input /
output suggestion character counts; generated content is never logged. Fixed requests and
prompt-only length guidance were rejected because a single line can contain many sentences.

## 2026-09-10 amendment: continuous completion and composition

The user authorized continuous completion after Tab with a 200ms debounce; subsequent
ordinary input replaces it with the normal 600ms debounce. Matching pure text insertion
consumes the suggestion prefix locally and retains the remainder; each Tab insertion is
one separate undo event. Repeated held Tab events never accept subsequent suggestions.

Esc and undo/redo suppress requests at the current document/selection until an edit, actual
cursor movement or explicit completion configuration action. Focus and menu restoration
must respect this suppression and provider backoff. Empty/error responses do not loop.
Configuration events distinguish model/provider/style so ordinary UI resets and style
changes cannot clear authentication suspension or cooldown. Main remains authoritative.

Composition hides but retains the current candidate and its original document/selection.
No preedit spelling is matched. After host and ProseMirror composition settlement, only
an unchanged document or verified pure insertion at the original caret may restore or
consume the candidate. Other changes, blur or revoked authority discard it. IME candidate
keys take precedence. Suggestions, timers and requests remain ephemeral and bounded;
reason enums enrich existing safe lifecycle logs without document or preedit content.

## 2026-09-14 amendment: application defaults and temporary overrides

The user authorized application-global default enablement (initially false) and the
existing word/sentence/paragraph default style in Default Models. The existing style
key retains its value; a boolean app_settings key adds default enablement without a
schema migration. This supersedes project-session-only enablement and toolbar style
persistence above.

Main owns independent optional enabled/style overrides for the application process
lifetime. Editor operations change only these overrides, including across project
close/open; exiting the application clears them. Unoverridden fields immediately
follow saved defaults. Restore defaults clears both overrides. Missing credentials
or a model prevent requests without erasing user intent. Session capabilities still
protect every editor operation, and revocation cancels pending/delivered work without
clearing application preferences. Effective changes invalidate suggestions without
resetting authentication suspension or cooldown. Settings and runtime projections are
separate validated contracts; the renderer cannot persist temporary choices implicitly.

Existing shadcn controls expose defaults and temporary state. No worker transport,
completion budgets, dependency, project schema or release change is required.
