export type AgentMessageMode = "ai" | "context" | "error" | "input" | "summary";
export type AgentMessageRole = "assistant" | "system" | "user";

export interface AgentMemoryScope {
  channel: string;
  threadId: string;
  userId: string;
  workflow: string;
  workspaceId: string;
}

export interface AgentMessageWindowItem {
  content: string;
  createdAt: string;
  mode: AgentMessageMode;
  role: AgentMessageRole;
  sequence: number;
}

export interface AppendAgentMessageInput {
  content: string;
  evidence?: string[];
  metadata?: Record<string, unknown>;
  mode: AgentMessageMode;
  now?: string;
  role: AgentMessageRole;
  scope: AgentMemoryScope;
}

export interface AppendAgentMessageResult {
  messageId: string;
  sequence: number;
  threadKey: string;
}

interface ThreadCounterRow {
  message_count: number;
}

interface AgentMessageRow {
  content: string;
  created_at: string;
  mode: AgentMessageMode;
  role: AgentMessageRole;
  sequence: number;
}

export const AGENT_CONTEXT_LAST_MESSAGES = 20;
export const AGENT_CONTEXT_MAX_CHARS = 6000;

const THREAD_ID_PATTERN = /^[A-Za-z0-9:_-]{1,160}$/;
const SAFE_SEGMENT_PATTERN = /[^A-Za-z0-9:_-]/g;

export function isValidAgentThreadId(value: string) {
  return THREAD_ID_PATTERN.test(value);
}

export function defaultAgentThreadId(options: {
  userId: string;
  workflow: string;
  workspaceId: string;
}) {
  return [
    safeThreadSegment(options.workspaceId),
    safeThreadSegment(options.userId),
    safeThreadSegment(options.workflow),
  ].join(":");
}

export function agentThreadKey(scope: AgentMemoryScope) {
  return [
    safeThreadSegment(scope.workspaceId),
    safeThreadSegment(scope.channel),
    safeThreadSegment(scope.userId),
    safeThreadSegment(scope.workflow),
    safeThreadSegment(scope.threadId),
  ].join(":");
}

export async function appendAgentMessage(
  db: D1Database,
  input: AppendAgentMessageInput
): Promise<AppendAgentMessageResult> {
  const threadKey = agentThreadKey(input.scope);
  const now = input.now ?? new Date().toISOString();
  await db
    .prepare(
      `INSERT INTO pm_agent_thread
       (thread_key, workspace_id, channel, user_id, workflow, thread_id,
        message_count, last_mode, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, 0, ?, ?, ?)
       ON CONFLICT(thread_key) DO UPDATE SET
         last_mode = excluded.last_mode,
         updated_at = excluded.updated_at`
    )
    .bind(
      threadKey,
      input.scope.workspaceId,
      input.scope.channel,
      input.scope.userId,
      input.scope.workflow,
      input.scope.threadId,
      input.mode,
      now,
      now
    )
    .run();
  const counter = await db
    .prepare(
      `UPDATE pm_agent_thread
       SET message_count = message_count + 1,
           last_mode = ?,
           updated_at = ?
       WHERE thread_key = ?
       RETURNING message_count`
    )
    .bind(input.mode, now, threadKey)
    .first<ThreadCounterRow>();
  if (!counter) {
    throw new Error("Agent thread counter update failed.");
  }
  const messageId = crypto.randomUUID();
  await db
    .prepare(
      `INSERT INTO pm_agent_message
       (id, thread_key, sequence, role, content, mode, evidence_json,
        metadata_json, content_chars, estimated_tokens, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .bind(
      messageId,
      threadKey,
      counter.message_count,
      input.role,
      input.content,
      input.mode,
      JSON.stringify(input.evidence ?? []),
      JSON.stringify(input.metadata ?? {}),
      input.content.length,
      estimateTokens(input.content),
      now
    )
    .run();
  return {
    messageId,
    sequence: counter.message_count,
    threadKey,
  };
}

export async function readAgentContextWindow(
  db: D1Database,
  threadKey: string,
  options: { lastMessages?: number; maxChars?: number } = {}
) {
  const lastMessages = Math.max(
    1,
    Math.min(AGENT_CONTEXT_LAST_MESSAGES, options.lastMessages ?? 20)
  );
  const maxChars = Math.max(
    256,
    Math.min(AGENT_CONTEXT_MAX_CHARS, options.maxChars ?? 6000)
  );
  const rows = await db
    .prepare(
      `SELECT sequence, role, content, mode, created_at
       FROM pm_agent_message
       WHERE thread_key = ?
       ORDER BY sequence DESC
       LIMIT ?`
    )
    .bind(threadKey, lastMessages)
    .all<AgentMessageRow>();
  let usedChars = 0;
  const window: AgentMessageWindowItem[] = [];
  for (const row of rows.results) {
    const nextUsedChars = usedChars + row.content.length;
    if (window.length > 0 && nextUsedChars > maxChars) {
      break;
    }
    usedChars = nextUsedChars;
    window.push({
      content: row.content,
      createdAt: row.created_at,
      mode: row.mode,
      role: row.role,
      sequence: row.sequence,
    });
  }
  return window.reverse();
}

export function contextWindowStats(
  messages: readonly AgentMessageWindowItem[]
) {
  const characters = messages.reduce(
    (sum, item) => sum + item.content.length,
    0
  );
  return {
    characters,
    estimatedTokens: estimateTokens(
      messages.map((message) => message.content).join("\n")
    ),
    messages: messages.length,
  };
}

function estimateTokens(content: string) {
  return Math.max(1, Math.ceil(content.length / 4));
}

function safeThreadSegment(value: string) {
  const cleaned = value.replace(SAFE_SEGMENT_PATTERN, "_").slice(0, 160);
  return cleaned || "default";
}
