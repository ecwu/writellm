# ADR 037: Bounded Project Template Catalog

- Status: Accepted
- Date: 2026-08-13
- Checkpoints: 47A and 47B

## Context

Authors need reusable starting structure without copying an old project's manuscript, identity, or
private data. Writing Skills are Agent guidance and must not become executable project templates.
Raw project cloning is also the wrong boundary because templates intentionally retain only a small
approved subset.

## Decision

Project templates are strict, versioned data with format `writellm-project-template` version 1.
The schema permits only a Brief skeleton, ordered outline metadata, Writing Rules without their
source IDs, and an optional publication-preset reference. It cannot represent manuscript bodies,
citations, knowledge, assets, annotations, Agent state, review state, project IDs, credentials,
paths, executable content, skills, or plugins. Unknown fields fail closed. Applying a template
uses the normal new-project bootstrap and existing Main-owned Brief/outline/Writing Rule services;
Main mints every project, section, revision, and rule identity. A missing optional publication
preset never blocks project creation.

Two reviewed built-ins are bundled as an application JSON resource and parsed through the same
shared schema before they are listed. They do not require app-database rows and are immutable.

User templates use a bounded application-global catalog. `app.sqlite.project_templates` stores
only display metadata, a safe UUID filename, SHA-256, schema version, inclusion counts, and dates.
Canonical JSON files live under the application user-data `project-templates/` directory. Main
writes the file atomically before inserting its catalog row; reads verify the hash, schema,
template/file identity, and name. Tampered entries remain visible as `integrity_failed` but cannot
be applied. The catalog is capped at 50 user templates and enforces case-insensitive unique names.
Deleting the source project does not affect the extracted file.

Extraction first flushes the active editor, pauses project mutations, and shows the complete
approved inclusion counts plus an explicit exclusion list. Save re-reads the same bounded
authoritative surfaces and creates an independent template file. It never scans or copies the
project folder and never uses a model, hidden conversation, or specialized extraction endpoint.

## Consequences

- Templates are fixtures around existing project creation, not a package manager or execution
  system.
- Built-in resource corruption fails closed during catalog construction; user-file corruption is
  isolated to that entry.
- Source writing-rule IDs are stripped and regenerated, and outline relationships use temporary
  template keys rather than copied section IDs.
- Import/export of template packages, remote catalogs, template scripting, and arbitrary inclusion
  matrices remain out of scope.
