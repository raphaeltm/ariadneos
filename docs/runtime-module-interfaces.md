# Runtime module interfaces

Issue #14 freezes importable contracts only. These interfaces describe how later runtime modules connect without implementing Slack ingestion, extraction, graph rebuilds or observer behavior in this PR.

All types are exported from `shared/contracts.ts`.

## Ingestion

`IngestionPort.recordObservation(input: RawObservation): Promise<IngestionResult>` accepts a signature-verified raw source event scoped by `workspace_id` and `channel`. Implementations persist immutable observations, update the current `Message` projection, dedupe by stable event id and return the message plus operation id when accepted.

## Extraction

`ExtractionPort.extract(window, priorSteps, context): Promise<ExtractionResult>` accepts scoped `Message` windows, existing session steps and compact KB context. Implementations classify modality before materializing steps, keep `modality`, `lifecycle_state` and `status` separate, and return promise-report reconciliation records. `discussed` work is intentionally absent from the returned type.

## Graph

`GraphPort.rebuild(input): Promise<GraphRebuildResult>` accepts KB, messages, sessions, steps and an optional previous graph. Implementations rebuild from done, confirmed, non-negated steps; authored KB still contributes designed nodes and edges. The result includes the full graph, a `GraphDelta` with an exact `base_revision`, and the journal envelope to replay over SSE.

## Observer

`ObserverPort.evaluate(input): Promise<ObserverDecision[]>` accepts the latest committed journal event with the scoped snapshot and conformance. Implementations can enqueue posts, pauses or rebuilds, but must cite evidence through typed `EvidenceRef` and must not treat role repertoires as permission gates.

## Citation and replay contracts

`Citation` distinguishes Slack evidence, KB records, aggregate counts and persisted records. Graph-RAG code should reject factual claims whose citation cannot resolve to one of those records. `JournalEnvelope` is the durable SSE replay frame; clients apply the `kind` discriminator and recover from `reset` by requesting a new `Snapshot`.
