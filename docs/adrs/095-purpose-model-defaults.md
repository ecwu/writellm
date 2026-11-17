# ADR 095: Model defaults by purpose

Status: accepted on 2026-11-17 for [Issue 21](https://github.com/ecwu/writellm/issues/21).

## Decision

Settings gives each purpose its own default. The selected source controls which connection and models the user edits. Only an explicit selection sets a default. Main stores a reference to the enabled model configuration and its source in application storage. Display names and model IDs can repeat across sources.

When the user disables or removes a default model or its source, Main clears the default and Settings reports the change. A temporary connection or authentication failure preserves the selection. Settings shows its source, model, and reason for unavailability. Opening Settings and browsing sources use local data. Discovery and connection tests require explicit actions. Failed discovery preserves saved models and the last successful candidate list for that connection.

Agent and Image Generation retain their existing catalogs and conversation rules. Autocomplete uses its own DeepSeek capability catalog and preferences. It shares the enabled built-in DeepSeek source and its credentials with Agent. A common selector can display these catalogs without moving their storage or granting another component access to credentials.

A newly discovered Agent model starts disabled. The user can enable it for that source and then choose it as a default. Fetching models preserves enabled models even when the provider omits them from a later response. A candidate that the user never enabled can disappear when the provider stops listing it.

During upgrade, previously available packaged and cached models keep their prior availability. Explicit preferences and manual models keep their saved values. Existing defaults and conversation references continue to identify the same source and model. The adoption rule applies when discovery first returns a new model. It requires no bulk rewrite of the prior catalog.

## Storage and migration

Speech sources can have multiple model configurations. Each configuration identifies a model and its realtime or file mode. The same model ID can appear in both modes. Migration imports each existing model and mode under its original source and maps the active source to its specific configuration.

Embedding and Reranking each support several sources with multiple model configurations. Migration imports each existing configured connection, model, and revision as that purpose's default. Embedding also retains its dimension. Migration preserves the credential binding and encrypted value. An unconfigured purpose starts without a default.

Before changing the Embedding default, Settings warns that affected projects need an index update. Each generation retains its embedding contract, including the source identity, model, revision, and dimensions. Main resolves compatible query embeddings against that contract. If the original contract is unavailable, the existing index update workflow restores compatibility. Reranking resolves the default for each new request.

Document Parsing keeps the MinerU adapter and its supported modes. A new job binds its source and mode before submission. A retry or restart uses that binding and the persisted remote task ID when available. An unavailable original connection requires recovery guidance. Migration must associate existing submitted tasks with the original MinerU configuration before another default can redirect a request. Project storage holds only nonsecret identity and recovery metadata.

Main owns all credentials and resolves the connection for each request. Each forward migration uses the existing backup, integrity, and recovery gates. The migration must preserve old session selections, credential bindings, and index provenance across restart.

## Schema and runtime binding

Application migration 0013 adds source, model, and default tables to `app.sqlite`. Each source references the existing credential-bearing connection row. Defaults reference models by purpose, source ID, and configuration ID. The database clears a default when its model or source is disabled or deleted.

The imported Embedding source retains the legacy contract hash. New source identities distinguish connections that share an endpoint and model. Query execution narrows the available models by model ID, revision, and dimensions before matching the exact contract hash.

Project migration 0050 binds each prior MinerU task to the imported source and configuration. Before a remote operation, Main checks the saved model and connection fingerprint. A recoverable job polls its persisted remote ID through the bound source. It retains that ID when the source requires repair.

## Alternatives and acceptance

One default for all purposes would couple independent tasks and prevent separate choices for chat and completion. Using a model ID alone would make duplicate names across sources and Speech modes ambiguous.

Deliver the Settings layout and existing catalogs first. Introduce additional storage in subsequent batches. Acceptance requires upgrades from prior configurations, restart tests, controlled desktop provider tests, compatible vector queries, and recovery of submitted parsing jobs. The [current plan](../current-plan.md) records implementation and verification status.
