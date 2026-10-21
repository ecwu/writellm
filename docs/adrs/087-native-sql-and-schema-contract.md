# ADR 087: Native SQL And The Project Schema Contract

Status: accepted under the user's Issue 18 implementation request
Date: 2026-10-21

## Context

The architecture baseline described application and project storage as better-sqlite3 with Kysely.
The application uses Kysely in selected repositories, but most project operations use prepared SQL through better-sqlite3.
The project database type map is maintained by hand and can drift from the forward migration chain.
Several migrations also repeated the same `hasColumn` helper.

## Decision

Prepared SQL through better-sqlite3 is the primary project database implementation.
Kysely remains an available typed adapter for modules that already use it.
This decision does not start a migration from prepared SQL to Kysely and does not add a query or RPC framework.

`ProjectDatabaseSchema` remains the type contract for Kysely users.
An Electron-hosted contract test runs the complete project migration chain in an in-memory database.
It compares the migrated tables and columns with `ProjectDatabaseSchema` and checks nullable columns and SQLite storage classes where the TypeScript type provides that information.
The test includes migration metadata tables and ignores SQLite internal tables and views.

Forward migrations use one shared, identifier-bounded `hasColumn` helper.
The helper keeps the existing migration SQL, versions, and checksums unchanged.

## Compatibility And Consequences

This clarification adds no migration and changes no stored data.
Existing databases continue to validate against their recorded migration checksums.
The schema contract test fails when a migration adds or removes a table or column without a matching type update.
The test cannot prove constraints, indexes, triggers, view definitions, or the meaning of a JSON field.
Those rules remain covered by migration and feature tests.

The rejected alternative is a full Kysely migration.
That change touches many prepared SQL call sites and adds risk without improving the process boundary.

## Verification

The contract test passes through migration 0048.
Focused recovery tests for migrations 0046, 0047, and 0048 pass with the shared harness.

## Source

[Issue 18](https://github.com/ecwu/writellm/issues/18) records the audit finding and the recommended low-risk clarification.
