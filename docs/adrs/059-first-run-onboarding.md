# ADR 059: First-Run Provider And Project Onboarding

Status: accepted for Checkpoint 67
Date: 2026-08-23

## Decision

WriteLLM adds one versioned first-run onboarding surface beneath the persistent application
Menubar. The flow has six ordered steps: welcome, Agent provider, Embedding provider, Reranking
provider, MinerU provider, and project creation. Every step remains optional. Provider steps reuse
the existing application-global provider workspaces and project creation uses the existing
Main-owned folder-selection and project-publication boundary.

Onboarding progress is application-global UI state in `app.sqlite`. It stores only the current
bounded step or a completed marker. It stores no provider configuration, credential, project
path, project identity, or content. Main validates and persists that state through sender-authorized
IPC; the Renderer receives no database or generic settings authority.

Advancing or going back records the destination step so an interrupted first run resumes without
repeating completed setup. Explicitly skipping the whole flow, skipping the final project step, or
successfully opening or creating a project records completion. Individual provider-step skips do
not synthesize provider configuration. Provider availability remains derived from the existing
bounded provider snapshot and can be changed later through Settings.

An upgraded application with no onboarding marker but with existing application settings, recent
projects, provider configuration/preferences, or installed Writing Skills is treated as already
completed. Only an application with no persisted usage evidence receives the first-run default.

## Consequences

No application or project schema migration is required because `app_settings` already owns
versioned application preferences. Provider credentials remain write-only from the Renderer and
encrypted by the existing credential service. Project creation still requires Main's native
directory picker and atomically publishes the portable `<name>.writellm` child.

The ordinary closed-project surface remains available after dismissal, including Create, Open,
Settings, recovery actions, and recent projects. Onboarding does not become a tutorial mode, does
not add analytics or remote state, and does not block experienced users from reaching the existing
application.
