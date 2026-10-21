# ADR 088: Typed IPC Endpoint Definitions

Status: accepted under the user's Issue 18 implementation request
Date: 2026-10-21

## Context

WriteLLM declares each IPC operation in several layers. The channel, input schema, output schema,
preload invocation, and Main handler repeat the same contract. Repeated declarations make sender
authorization, session checks, and output validation easy to omit during maintenance.

The application already uses narrow IPC channels and shared Zod schemas. A general RPC framework
would add a new privileged boundary and would conflict with the accepted architecture.

## Decision

Use a small typed endpoint definition for each migrated IPC operation. The definition contains the
channel, input schema, output schema, and session requirement (`none`, `active`, or `mutation`).

Use one Main registration helper to authorize the sender, parse input, enforce the declared project
session capability, call the domain handler, and parse the output. Use one preload invocation helper
to parse input and output. Keep the existing `withIpcLogging` wrapper around all Main registrations.

Define endpoint tables by domain. Derive preload method input and output types from those tables where
the public API returns the IPC result directly. Keep explicit adapters for subscription lifecycles,
dialog and file capture, replay, and APIs that intentionally project a nested IPC result such as a
checkpoint or Agent run.

The endpoint helper does not expose filesystem, database, Node.js, or generic IPC authority to the
Renderer. It does not replace sender authorization, project-session authorization, or the four
existing Zod validation boundaries.

## Migration

Application-scoped settings and publication preset endpoints are migrated first. Project, manuscript,
editor, Knowledge/search, and Agent endpoints migrate in domain batches. Each batch keeps custom
lifecycle, subscription, replay, and final-flush flows explicit until an equivalent typed adapter
exists. Agent proposal mutations retain their lifecycle-owned session assertion so their existing
operation audit events and safe errors remain intact; attachment handlers retain their safe error
boundary through the endpoint wrapper.

No database migration, channel rename, or Renderer capability expansion is required. Existing tests
remain the acceptance boundary for authorization, session revocation, input rejection, and output
validation.

## Rejected alternatives

Do not introduce a broad RPC framework, generate a privileged catch-all method, or remove Main output
validation because a preload parse already ran. Do not infer session authority from a channel name.

## Verification

Focused endpoint tests cover sender rejection, input and output parsing, active and mutation session
checks, inputless calls, and unregister behavior. Each migrated domain retains its existing IPC and
Electron tests.
