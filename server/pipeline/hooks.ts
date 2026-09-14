// Channel coordinator deadline hooks that run the production pipeline.
//
// The coordinator owns per-channel serialization and alarm scheduling; these hooks
// supply the work. Keeping them here rather than inside the Durable Object keeps
// the pipeline testable without a Durable Object runtime.

import type { GraphView } from "../../shared/contracts.ts";
import { buildScopedGraphView } from "../process-data.ts";
import type {
  ChannelHook,
  ChannelHookContext,
  ChannelHooks,
} from "../runtime/channel.ts";
import {
  clientForWorkspace,
  readChannel,
  readInstall,
} from "../tenant/installs.ts";
import { closeIdleSessions } from "../tenant/sessions.ts";
import { type AnswerEnv, answerMentions } from "./answer.ts";
import { type ExtractionEnv, runExtraction } from "./extraction.ts";
import { type OutboxEnv, pendingOutboxCount, runOutbox } from "./outbox.ts";

export interface PipelineEnv extends AnswerEnv, ExtractionEnv, OutboxEnv {
  DB: D1Database;
}

const EXTRACTION_IDLE_MS = 30_000;
const EXTRACTION_BUSY_MS = 2000;
const BEAT_MS = 60_000;

async function pendingExtractionCount(
  db: D1Database,
  scope: { channel: string; workspaceId: string }
) {
  const row = await db
    .prepare(
      `SELECT COUNT(*) AS count FROM pm_processing
       WHERE workspace_id = ? AND channel = ? AND status = 'pending'`
    )
    .bind(scope.workspaceId, scope.channel)
    .first<{ count: number }>();
  return row?.count ?? 0;
}

/**
 * Publishes the rebuilt graph so connected clients see extraction results without
 * polling. A commit is skipped when the graph hash is unchanged, so an extraction
 * run that produced no new steps does not emit a redundant frame.
 */
async function publishGraph(
  env: PipelineEnv,
  context: ChannelHookContext,
  input: { projectId: string; workflowId: string | null }
) {
  const built = await buildScopedGraphView(env.DB, context.scope, {
    projectId: input.projectId,
    workflowId: input.workflowId ?? undefined,
  });
  if (!built) {
    return null;
  }
  await context.commit({
    kind: "graph_delta",
    opKey: `graph:${built.graph.key}:${built.graph.revision}`,
    payload: built.graph satisfies GraphView,
    projectId: input.projectId,
  });
  if (built.conformance) {
    await context.commit({
      kind: "conformance",
      opKey: `conformance:${built.graph.key}:${built.graph.revision}`,
      payload: built.conformance,
      projectId: input.projectId,
    });
  }
  return built;
}

/**
 * Extraction hook: drains pending observations, republishes the graph, and
 * reschedules itself tightly while a queue remains so a burst of Slack traffic is
 * caught up quickly rather than one batch per idle interval.
 */
export function extractionHook(env: PipelineEnv): ChannelHook {
  return async (context) => {
    const channel = await readChannel(
      env.DB,
      context.scope.workspaceId,
      context.scope.channel
    );
    if (!(channel?.enabled && channel.project_id)) {
      return { rescheduleAt: null };
    }
    const outcome = await runExtraction(env, context.scope);
    const remaining = await pendingExtractionCount(env.DB, context.scope);
    if (outcome.stepsWritten > 0) {
      const workflowId = await workflowForProject(
        env.DB,
        context.scope.workspaceId,
        channel.project_id
      );
      await publishGraph(env, context, {
        projectId: channel.project_id,
        workflowId,
      });
    }
    return {
      checkpoint: {
        extraction_model_calls: String(outcome.modelCalls),
        extraction_pending: String(remaining),
        extraction_steps: String(outcome.stepsWritten),
        ...(outcome.warnings.length
          ? { extraction_warning: outcome.warnings[0] ?? "" }
          : {}),
      },
      rescheduleAt:
        context.now + (remaining > 0 ? EXTRACTION_BUSY_MS : EXTRACTION_IDLE_MS),
    };
  };
}

/**
 * Beat hook: delivers queued agent posts and closes cases whose channel has gone
 * quiet, so a session does not stay open indefinitely after work finishes.
 */
export function beatHook(env: PipelineEnv): ChannelHook {
  return async (context) => {
    const channel = await readChannel(
      env.DB,
      context.scope.workspaceId,
      context.scope.channel
    );
    if (!(channel?.enabled && channel.project_id)) {
      return { rescheduleAt: context.now + BEAT_MS };
    }
    // Answer outstanding mentions first, then drain: a mention asked since the
    // last beat is answered in the same pass rather than a minute later.
    const install = await readInstall(env.DB, context.scope.workspaceId);
    const answers = install
      ? await answerMentions(env, channel, install.bot_user_id)
      : { answered: 0, skipped: 0, warnings: ["answer.no_install"] };
    const client = await clientForWorkspace(env.DB, context.scope.workspaceId);
    const delivery = await runOutbox(env, context.scope, { client });
    for (const sessionId of await closeIdleSessions(
      env.DB,
      channel,
      context.now
    )) {
      // biome-ignore lint/performance/noAwaitInLoops: journal entries must be committed in order to keep cursors monotonic.
      await context.commit({
        kind: "session_closed",
        opKey: `session_closed:${sessionId}`,
        payload: { reason: "idle", session_id: sessionId },
        projectId: channel.project_id,
        sessionId,
      });
    }
    return {
      checkpoint: {
        mentions_answered: String(answers.answered),
        outbox_delivered: String(delivery.delivered),
        outbox_pending: String(await pendingOutboxCount(env.DB, context.scope)),
      },
      rescheduleAt: context.now + BEAT_MS,
    };
  };
}

/**
 * Recovery hook: requeues checkpoints that failed transiently and schedules an
 * immediate extraction pass, so a restart resumes a partially mined channel.
 */
export function recoveryHook(env: PipelineEnv): ChannelHook {
  return async (context) => {
    const nowIso = new Date(context.now).toISOString();
    await env.DB.prepare(
      `UPDATE pm_processing
       SET status = 'pending', updated_at = ?
       WHERE workspace_id = ? AND channel = ? AND status = 'error' AND retries < 3`
    )
      .bind(nowIso, context.scope.workspaceId, context.scope.channel)
      .run();
    const pending = await pendingExtractionCount(env.DB, context.scope);
    return {
      checkpoint: { pending_processing: String(pending) },
      rescheduleAt: null,
    };
  };
}

export function pipelineHooks(env: PipelineEnv): ChannelHooks {
  return {
    beat: beatHook(env),
    extraction: extractionHook(env),
    recovery: recoveryHook(env),
  };
}

async function workflowForProject(
  db: D1Database,
  workspaceId: string,
  projectId: string
) {
  const row = await db
    .prepare(
      "SELECT workflow_id FROM tenant_project WHERE workspace_id = ? AND id = ?"
    )
    .bind(workspaceId, projectId)
    .first<{ workflow_id: string | null }>();
  return row?.workflow_id ?? null;
}
