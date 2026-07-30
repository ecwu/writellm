# ADR 009: Settings Workspace And Agent Model Availability

Status: implemented by Checkpoint 23Q
Date: 2026-07-30

## Decision

WriteLLM keeps Settings as one application-global shadcn Command surface, but replaces the
command-to-nested-dialog flow with a responsive settings workspace. Its primary navigation owns
General, Agent API, Embedding API, Reranking API, MinerU API, and Image API. Agent API adds a
provider list before the selected provider's credential, endpoint, and model details. The other
provider roles remain singleton configuration surfaces.

Application-global Agent provider and model preferences determine which authenticated models are
available for future conversation runs. Provider and model disablement never rewrites a stored
conversation selection or an immutable run snapshot. Main revalidates availability when resolving
the next run and performs no silent fallback. Disabling or deleting a selected default clears the
default; an affected idle conversation must choose another enabled model before it can run.

Pi's packaged and last-successful discovered catalogs remain distinct from application-owned
manual models. Manual models store only bounded non-secret metadata and overlay a discovered model
with the same provider/model ID. Explicit refresh replaces only discovered catalog data and
retains manual models, enablement preferences, and the prior discovered catalog after failure.
Built-in Pi endpoints remain fixed. Custom preset names and endpoints are editable, while their
transport is immutable after creation.

The Renderer receives only bounded provider/model status and preference projections. API keys,
OAuth credentials, ambient credentials, and resolved request authentication remain Main-owned and
write-only from the Renderer. General appearance adds a bounded semantic accent preset alongside
the existing system/light/dark preference.

Provider identity uses an explicitly synchronized, reviewed models.dev logo snapshot committed as
local application assets. The synchronization command validates response types, byte limits, SVG
markup, external references, and content hashes before updating the generated manifest. The
Renderer never requests a logo from models.dev, and the existing content-security policy is not
expanded. Built-in providers resolve through explicit aliases; custom providers resolve through a
bounded manual override, exact Base URL, or unique name/ID match, with an initial fallback. Only a
validated optional logo ID crosses the Renderer-safe catalog boundary and persists in the existing
custom-provider JSON.

The Agent sidebar exposes one sequential shadcn Popover/Command selector rather than a flat or
side-by-side provider/model control. An existing valid selection opens at that provider's models;
the back action reaches the searchable provider level. New selections drill from a searchable
provider list into that provider's searchable models. This changes presentation only: the existing
conversation-selection IPC, idle/approval disablement, Main availability validation, and immutable
active-run snapshots remain authoritative.

## Consequences

`app.sqlite` adds application-owned Agent provider preferences and model preferences/manual model
metadata. Project databases and Agent run schemas do not change. Existing authenticated providers
and catalog models remain enabled when no explicit preference exists, preserving upgraded behavior.
Provider-logo refresh is an explicit developer operation and introduces no SDK or runtime network
dependency. models.dev source and trademark attribution ship with the repository.
Checkpoint 24 export and portability work remains unstarted.
