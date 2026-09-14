// Production extraction pipeline.
//
// Drains pm_processing checkpoints for one channel, runs the real model-backed
// extractor over each affected session's message window, canonicalizes the result
// against the workspace's authored activities, and persists steps with their
// message evidence.
//
// Runs from the channel coordinator's extraction deadline, so work is serialized
// per channel and a failure retries with backoff instead of being lost.

import type { EvidenceRef, Step } from "../../shared/contracts.ts";
import { canonicalize } from "../mining/canonicalize.ts";
import { extract } from "../mining/extract.ts";
import type {
  ActivityId,
  ExtractedStep,
  ExtractionContext,
  NormalizedObservation,
  PersonId,
  RoleRepertoire,
} from "../mining/types.ts";
import {
  createBudgetedModelAdapter,
  createOpenRouterModelAdapter,
  type ModelEnv,
} from "../models.ts";
import { readTenantKb, type TenantKb } from "../tenant/kb.ts";

export interface ExtractionEnv extends ModelEnv {
  DB: D1Database;
  EXTRACTION_MAX_MODEL_CALLS?: string;
  EXTRACTION_MAX_SESSIONS_PER_RUN?: string;
  EXTRACTION_WINDOW_SIZE?: string;
}

export interface ExtractionOutcome {
  checkpointsFailed: number;
  checkpointsProcessed: number;
  modelCalls: number;
  sessions: string[];
  stepsWritten: number;
  warnings: string[];
}

interface PendingRow {
  checkpoint_id: string;
  observation_id: string;
  retries: number;
}

interface WindowRow {
  author_label: string;
  author_person_id: string | null;
  availability: string;
  deleted: number;
  id: string;
  is_agent: number;
  permalink: string;
  received_at: string;
  revision: number;
  session_id: string;
  text: string;
  thread_ts: string | null;
  ts: string;
}

interface ExistingStepRow {
  activity_id: string | null;
  actor_person_id: string | null;
  confidence: number;
  curation_status: Step["status"];
  id: string;
  intent: string;
  lifecycle_state: Step["lifecycle_state"];
  modality: Step["modality"];
  negated: number;
  seq: number;
  session_id: string;
  ts_start: string;
  type: Step["type"];
}

const DEFAULT_WINDOW_SIZE = 40;
const DEFAULT_MAX_SESSIONS = 4;
const DEFAULT_MAX_MODEL_CALLS = 12;
const MAX_RETRIES = 3;
const ACTIVITY_ID_PREFIX = /^act_/;

function intFromEnv(
  value: string | undefined,
  fallback: number,
  bounds: { max: number; min: number }
) {
  const parsed = Number.parseInt(value ?? "", 10);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }
  return Math.min(Math.max(parsed, bounds.min), bounds.max);
}

/**
 * Builds the extraction context from workspace-authored definitions. An empty
 * activity set means the workspace has not defined its process yet; extraction is
 * skipped rather than inventing activities from message text.
 */
export function extractionContextFor(
  kb: TenantKb,
  workflowId: string
): ExtractionContext | null {
  const workflow = kb.workflows.find((item) => item.id === workflowId);
  if (!workflow || workflow.activities.length === 0) {
    return null;
  }
  return {
    activities: workflow.activities.map((activity) => ({
      id: `act_${activity.slug}` as ActivityId,
      label: activity.label,
      role_expected: activity.role || null,
      slug: activity.slug,
    })),
    // Artifacts require a connector beyond Slack; extraction must not invent them.
    artifacts: [],
    people: kb.people.map((person) => ({
      id: person.id as PersonId,
      name: person.name,
      role: person.role,
    })),
    role_repertoires: kb.roleCapabilities.map(
      (capability): RoleRepertoire => ({
        never_performs: capability.never_performs as ActivityId[],
        performs: capability.performs as ActivityId[],
        role_id: capability.role,
      })
    ),
  };
}

function toObservation(row: WindowRow): NormalizedObservation {
  return {
    author_label: row.author_label,
    author_person_id:
      row.author_person_id as NormalizedObservation["author_person_id"],
    channel_id: "",
    deleted: row.deleted === 1,
    id: row.id,
    is_agent: row.is_agent === 1,
    permalink: row.permalink,
    received_at: row.received_at,
    revision: row.revision,
    session_id: row.session_id,
    text: row.text,
    thread_ts: row.thread_ts,
    ts: row.ts,
    workspace_id: "",
  };
}

function toPriorStep(row: ExistingStepRow): ExtractedStep {
  return {
    activity_id: row.activity_id as ExtractedStep["activity_id"],
    activity_slug: row.activity_id?.replace(ACTIVITY_ID_PREFIX, "") ?? "",
    actor_person_id: row.actor_person_id as ExtractedStep["actor_person_id"],
    artifact_id: null,
    confidence: row.confidence,
    evidence: [],
    handoff_to_person_id: null,
    id: row.id as ExtractedStep["id"],
    intent: row.intent,
    label: row.intent,
    lifecycle_state: row.lifecycle_state as ExtractedStep["lifecycle_state"],
    modality: row.modality as ExtractedStep["modality"],
    negated: row.negated === 1,
    role_deviation: false,
    seq: row.seq,
    session_id: row.session_id,
    status: row.curation_status as ExtractedStep["status"],
    ts_start: row.ts_start,
    type: row.type as ExtractedStep["type"],
  };
}

/**
 * Runs extraction for every session touched by pending checkpoints in a channel.
 *
 * Checkpoints are grouped by session because extraction reads a conversation
 * window, not a single message: one model call covers all of a session's pending
 * observations rather than one call per message.
 */
export async function runExtraction(
  env: ExtractionEnv,
  scope: { channel: string; workspaceId: string },
  options: { now?: () => string } = {}
): Promise<ExtractionOutcome> {
  const now = options.now ?? (() => new Date().toISOString());
  const outcome: ExtractionOutcome = {
    checkpointsFailed: 0,
    checkpointsProcessed: 0,
    modelCalls: 0,
    sessions: [],
    stepsWritten: 0,
    warnings: [],
  };
  const maxSessions = intFromEnv(
    env.EXTRACTION_MAX_SESSIONS_PER_RUN,
    DEFAULT_MAX_SESSIONS,
    { max: 20, min: 1 }
  );
  const windowSize = intFromEnv(
    env.EXTRACTION_WINDOW_SIZE,
    DEFAULT_WINDOW_SIZE,
    { max: 120, min: 5 }
  );
  const maxModelCalls = intFromEnv(
    env.EXTRACTION_MAX_MODEL_CALLS,
    DEFAULT_MAX_MODEL_CALLS,
    { max: 100, min: 1 }
  );

  if (!env.OPENROUTER_API_KEY) {
    outcome.warnings.push("extraction.missing_openrouter_key");
    return outcome;
  }

  const sessions = await pendingSessions(env.DB, scope, maxSessions);
  if (sessions.length === 0) {
    return outcome;
  }

  const kb = await readTenantKb(env.DB, scope.workspaceId);
  const model = createBudgetedModelAdapter(
    createOpenRouterModelAdapter(env),
    maxModelCalls
  );

  for (const session of sessions) {
    const context = session.workflow_id
      ? extractionContextFor(kb, session.workflow_id)
      : null;
    if (!context) {
      outcome.warnings.push(
        `extraction.no_authored_workflow:${session.session_id}`
      );
      // Leave the checkpoints pending: once the workspace authors its workflow,
      // the next run mines this session instead of dropping it permanently.
      continue;
    }
    // biome-ignore lint/performance/noAwaitInLoops: sessions share one model budget and must run in order.
    const result = await extractSession(env, {
      context,
      model,
      now: now(),
      scope,
      session,
      windowSize,
    });
    outcome.checkpointsFailed += result.checkpointsFailed;
    outcome.checkpointsProcessed += result.checkpointsProcessed;
    outcome.modelCalls += result.modelCalls;
    outcome.stepsWritten += result.stepsWritten;
    outcome.warnings.push(...result.warnings);
    outcome.sessions.push(session.session_id);
  }
  return outcome;
}

interface PendingSession {
  checkpoints: PendingRow[];
  project_id: string;
  session_id: string;
  workflow_id: string | null;
}

async function pendingSessions(
  db: D1Database,
  scope: { channel: string; workspaceId: string },
  limit: number
): Promise<PendingSession[]> {
  const rows = await db
    .prepare(
      `SELECT prc.checkpoint_id AS checkpoint_id,
              prc.observation_id AS observation_id,
              prc.retries AS retries,
              ses.id AS session_id,
              ses.project_id AS project_id,
              ses.workflow_id AS workflow_id
       FROM pm_processing prc
       JOIN slack_message_events evt
         ON evt.team_id = prc.workspace_id AND evt.event_id = prc.observation_id
       JOIN pm_message msg
         ON msg.workspace_id = prc.workspace_id
        AND msg.channel = prc.channel
        AND msg.ts = evt.message_ts
       JOIN pm_session ses ON ses.id = msg.session_id
       WHERE prc.workspace_id = ? AND prc.channel = ?
         AND prc.status = 'pending' AND prc.retries < ?
       ORDER BY msg.ts
       LIMIT 400`
    )
    .bind(scope.workspaceId, scope.channel, MAX_RETRIES)
    .all<
      PendingRow & {
        project_id: string;
        session_id: string;
        workflow_id: string | null;
      }
    >();

  const grouped = new Map<string, PendingSession>();
  for (const row of rows.results) {
    const existing = grouped.get(row.session_id);
    const checkpoint = {
      checkpoint_id: row.checkpoint_id,
      observation_id: row.observation_id,
      retries: row.retries,
    };
    if (existing) {
      existing.checkpoints.push(checkpoint);
      continue;
    }
    if (grouped.size >= limit) {
      continue;
    }
    grouped.set(row.session_id, {
      checkpoints: [checkpoint],
      project_id: row.project_id,
      session_id: row.session_id,
      workflow_id: row.workflow_id,
    });
  }
  return [...grouped.values()];
}

async function extractSession(
  env: ExtractionEnv,
  input: {
    context: ExtractionContext;
    model: Parameters<typeof extract>[3];
    now: string;
    scope: { channel: string; workspaceId: string };
    session: PendingSession;
    windowSize: number;
  }
) {
  const { session } = input;
  const result = {
    checkpointsFailed: 0,
    checkpointsProcessed: 0,
    modelCalls: 0,
    stepsWritten: 0,
    warnings: [] as string[],
  };
  const windowRows = await env.DB.prepare(
    `SELECT id, session_id, author_person_id, author_label, text, permalink,
            thread_ts, revision, deleted, availability, is_agent, received_at, ts
     FROM pm_message
     WHERE workspace_id = ? AND channel = ? AND session_id = ?
     ORDER BY ts
     LIMIT ?`
  )
    .bind(
      input.scope.workspaceId,
      input.scope.channel,
      session.session_id,
      input.windowSize
    )
    .all<WindowRow>();

  // Deleted messages keep their evidence row but must not be re-read as text, and
  // agent posts are excluded so Ariadne cannot mine its own output.
  const window = windowRows.results
    .filter((row) => row.is_agent === 0 && row.deleted === 0 && row.text.trim())
    .map((row) => ({
      ...toObservation(row),
      channel_id: input.scope.channel,
      workspace_id: input.scope.workspaceId,
    }));

  if (window.length === 0) {
    await markCheckpoints(env.DB, session.checkpoints, "done", null, input.now);
    result.checkpointsProcessed += session.checkpoints.length;
    return result;
  }

  const priorRows = await env.DB.prepare(
    `SELECT id, session_id, seq, activity_id, actor_person_id, intent, type,
            modality, lifecycle_state, curation_status, negated, confidence, ts_start
     FROM pm_step
     WHERE session_id = ?
     ORDER BY seq`
  )
    .bind(session.session_id)
    .all<ExistingStepRow>();
  const priorSteps = priorRows.results.map(toPriorStep);

  const extraction = await extract(
    window,
    priorSteps,
    input.context,
    input.model
  );
  result.modelCalls += extraction.modelCalls;
  result.warnings.push(...extraction.warnings);
  if (extraction.degraded) {
    await markCheckpoints(
      env.DB,
      session.checkpoints,
      "error",
      extraction.warnings.join("; ").slice(0, 400),
      input.now
    );
    result.checkpointsFailed += session.checkpoints.length;
    return result;
  }

  const canonical = await canonicalize(
    extraction.steps,
    input.context.activities,
    input.model
  );
  result.modelCalls += canonical.modelCalls;
  result.warnings.push(...canonical.warnings);

  if (canonical.steps.length) {
    await persistSteps(env.DB, input.scope, session, canonical.steps);
    result.stepsWritten += canonical.steps.length;
  }
  await markCheckpoints(env.DB, session.checkpoints, "done", null, input.now);
  result.checkpointsProcessed += session.checkpoints.length;
  return result;
}

async function markCheckpoints(
  db: D1Database,
  checkpoints: readonly PendingRow[],
  status: "done" | "error",
  error: string | null,
  now: string
) {
  if (checkpoints.length === 0) {
    return;
  }
  await db.batch(
    checkpoints.map((checkpoint) =>
      db
        .prepare(
          `UPDATE pm_processing
           SET status = ?, error = ?, updated_at = ?,
               retries = retries + CASE WHEN ? = 'error' THEN 1 ELSE 0 END
           WHERE checkpoint_id = ?`
        )
        .bind(status, error, now, status, checkpoint.checkpoint_id)
    )
  );
}

async function persistSteps(
  db: D1Database,
  scope: { channel: string; workspaceId: string },
  session: PendingSession,
  steps: readonly ExtractedStep[]
) {
  const statements = steps.flatMap((step) => [
    db
      .prepare(
        `INSERT INTO pm_step
         (id, session_id, seq, activity_id, actor_person_id, artifact_id, intent,
          type, handoff_to_person_id, modality, lifecycle_state, curation_status,
          negated, confidence, ts_start, ts_end, effort_days)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL)
         ON CONFLICT(id) DO UPDATE SET
           seq = excluded.seq,
           activity_id = excluded.activity_id,
           actor_person_id = excluded.actor_person_id,
           intent = excluded.intent,
           type = excluded.type,
           handoff_to_person_id = excluded.handoff_to_person_id,
           modality = excluded.modality,
           lifecycle_state = excluded.lifecycle_state,
           negated = excluded.negated,
           confidence = excluded.confidence,
           ts_start = excluded.ts_start`
      )
      .bind(
        step.id,
        session.session_id,
        step.seq,
        step.activity_id,
        step.actor_person_id,
        step.artifact_id,
        step.intent,
        step.type,
        step.handoff_to_person_id,
        step.modality,
        step.lifecycle_state,
        step.status,
        step.negated ? 1 : 0,
        step.confidence,
        step.ts_start
      ),
    ...step.evidence.map((evidence) =>
      db
        .prepare(
          `INSERT INTO pm_step_evidence
           (step_id, workspace_id, channel, message_ts, message_revision,
            span_start, span_end)
           VALUES (?, ?, ?, ?, ?, NULL, NULL)
           ON CONFLICT(step_id, workspace_id, channel, message_ts) DO UPDATE SET
             message_revision = excluded.message_revision`
        )
        .bind(
          step.id,
          scope.workspaceId,
          scope.channel,
          evidence.ts,
          evidence.message_revision
        )
    ),
  ]);
  await db.batch(statements);
}

/** Evidence refs in the shape the journal and UI expect. */
export function toEvidenceRefs(
  step: ExtractedStep,
  scope: { channel: string; workspaceId: string }
): EvidenceRef[] {
  return step.evidence.map((evidence) => ({
    channel: scope.channel as EvidenceRef["channel"],
    message_id:
      `${scope.workspaceId}:${scope.channel}:${evidence.ts}` as EvidenceRef["message_id"],
    message_revision: evidence.message_revision,
    ts: evidence.ts as EvidenceRef["ts"],
    workspace_id: scope.workspaceId as EvidenceRef["workspace_id"],
  }));
}
