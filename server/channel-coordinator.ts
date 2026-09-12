import {
  CHANNEL_HEARTBEAT_MS,
  CHANNEL_MAX_BUFFERED_EVENTS,
  CHANNEL_MAX_STREAM_MS,
  CHANNEL_MAX_SUBSCRIBERS,
  type ChannelHook,
  type ChannelHookContext,
  type ChannelHooks,
  type ChannelRequestScope,
  type ChannelScope,
  type ChannelSnapshot,
  type ChannelStatus,
  commitJournalEntry,
  currentJournalCursor,
  type DeadlineKind,
  parseNonNegativeInteger,
  readJournalEnvelope,
  replayJournal,
  resetFrame,
  sseFrame,
} from "./runtime/channel.ts";

const DEADLINES: DeadlineKind[] = ["recovery", "extraction", "beat", "close"];
const encoder = new TextEncoder();

function ignorePromise(promise: Promise<unknown>) {
  promise.catch(() => undefined);
}

interface CoordinatorState {
  status: ChannelStatus;
}

interface DeadlineRow extends Record<string, SqlStorageValue> {
  due_at: number;
  kind: DeadlineKind;
}

interface Subscriber {
  close: () => void;
  pending: number;
  projectId: string;
  send: (envelope: Parameters<typeof sseFrame>[0]) => Promise<void>;
  tail: Promise<void>;
  write: (text: string) => Promise<void>;
}

export interface ChannelCoordinatorBindings {
  DB: D1Database;
}

const DurableObjectBase =
  (
    globalThis as typeof globalThis & {
      DurableObject?: new (
        state: DurableObjectState,
        env: ChannelCoordinatorBindings
      ) => object;
    }
  ).DurableObject ??
  class {
    protected ctx: DurableObjectState;
    protected env: ChannelCoordinatorBindings;

    constructor(state: DurableObjectState, env: ChannelCoordinatorBindings) {
      this.ctx = state;
      this.env = env;
    }
  };

export class ChannelCoordinatorCore {
  private readonly env: ChannelCoordinatorBindings;
  private readonly hooks: ChannelHooks;
  private readonly initialized: Promise<void>;
  private readonly scope: ChannelScope;
  private readonly state: DurableObjectState;
  private readonly subscribers = new Set<Subscriber>();
  private queue = Promise.resolve();

  constructor(
    state: DurableObjectState,
    env: ChannelCoordinatorBindings,
    scope: ChannelScope,
    hooks: ChannelHooks = {}
  ) {
    this.state = state;
    this.env = env;
    this.scope = scope;
    this.hooks = hooks;
    this.initialized = this.state.blockConcurrencyWhile(async () => {
      this.initializeStorage();
      await this.rescheduleAlarm();
    });
  }

  async alarm(now = Date.now()) {
    return await this.serialized(async () => {
      await this.runDueDeadlines(now);
    });
  }

  async fetch(request: Request) {
    const url = new URL(request.url);
    if (request.method === "GET" && url.pathname === "/snapshot") {
      const scoped = this.requestScope(url);
      return Response.json(await this.snapshot(scoped));
    }
    if (request.method === "GET" && url.pathname === "/stream") {
      const scoped = this.requestScope(url);
      const headerCursor = parseNonNegativeInteger(
        request.headers.get("Last-Event-ID")
      );
      const queryCursor = parseNonNegativeInteger(
        url.searchParams.get("after")
      );
      return await this.stream(
        scoped,
        headerCursor ?? queryCursor ?? 0,
        request
      );
    }
    if (request.method === "POST" && url.pathname === "/wake") {
      await this.serialized(async () => {
        this.writeDeadline("recovery", Date.now());
        await this.rescheduleAlarm();
      });
      return Response.json({ ok: true });
    }
    if (request.method === "POST" && url.pathname === "/broadcast") {
      const scoped = this.requestScope(url);
      const journalId = parseNonNegativeInteger(
        url.searchParams.get("journal_id")
      );
      if (journalId === null) {
        return Response.json(
          { error: "journal_id must be a non-negative integer." },
          { status: 400 }
        );
      }
      const envelope = await readJournalEnvelope(
        this.env.DB,
        scoped,
        journalId
      );
      if (!envelope) {
        return Response.json(
          { error: "Journal entry was not found." },
          { status: 404 }
        );
      }
      await Promise.allSettled(
        [...this.subscribers].map((subscriber) => subscriber.send(envelope))
      );
      return Response.json({ ok: true });
    }
    if (request.method === "POST" && url.pathname === "/schedule") {
      const body = await request.json<Partial<Record<DeadlineKind, number>>>();
      await this.serialized(async () => {
        for (const kind of DEADLINES) {
          const dueAt = body[kind];
          if (typeof dueAt === "number" && Number.isFinite(dueAt)) {
            this.writeDeadline(kind, Math.max(0, Math.trunc(dueAt)));
          }
        }
        await this.rescheduleAlarm();
      });
      return Response.json({ ok: true });
    }
    if (request.method === "POST" && url.pathname === "/pause") {
      await this.serialized(async () => {
        this.putState({ status: "paused" });
        await this.commitAndPublish({
          kind: "paused",
          opKey: `control:paused:${Date.now()}`,
          payload: { by: "api", reason: "requested" },
          projectId: url.searchParams.get("project_id") ?? "default",
        });
        await this.rescheduleAlarm();
      });
      return Response.json({ ok: true });
    }
    if (request.method === "POST" && url.pathname === "/resume") {
      await this.serialized(async () => {
        this.putState({ status: "running" });
        await this.commitAndPublish({
          kind: "resumed",
          opKey: `control:resumed:${Date.now()}`,
          payload: { by: "api" },
          projectId: url.searchParams.get("project_id") ?? "default",
        });
        await this.rescheduleAlarm();
      });
      return Response.json({ ok: true });
    }
    return Response.json({ error: "Not found." }, { status: 404 });
  }

  async snapshot(scoped: ChannelRequestScope): Promise<ChannelSnapshot> {
    return await this.serialized(async () => ({
      channel: scoped.channel,
      cursor: await currentJournalCursor(this.env.DB, scoped),
      deadlines: this.deadlines(),
      project_id: scoped.projectId,
      status: this.getState().status,
      workspace_id: scoped.workspaceId,
      ...(scoped.workflowId ? { workflow_id: scoped.workflowId } : {}),
    }));
  }

  async stream(scoped: ChannelRequestScope, after: number, request?: Request) {
    return await this.serialized(async () => {
      if (this.subscribers.size >= CHANNEL_MAX_SUBSCRIBERS) {
        return Response.json(
          { error: "Too many channel subscribers." },
          { status: 429 }
        );
      }
      const stream = new TransformStream<Uint8Array, Uint8Array>();
      const writer = stream.writable.getWriter();
      let closed = false;
      let heartbeat: ReturnType<typeof setInterval> | undefined;
      let maxAge: ReturnType<typeof setTimeout> | undefined;
      const subscriber: Subscriber = {
        close: () => {
          if (closed) {
            return;
          }
          closed = true;
          if (heartbeat) {
            clearInterval(heartbeat);
          }
          if (maxAge) {
            clearTimeout(maxAge);
          }
          this.subscribers.delete(subscriber);
          ignorePromise(writer.close());
        },
        pending: 0,
        projectId: scoped.projectId,
        send: async (envelope) => {
          if (subscriber.pending >= CHANNEL_MAX_BUFFERED_EVENTS) {
            subscriber.close();
            return;
          }
          subscriber.pending += 1;
          subscriber.tail = subscriber.tail
            .then(async () => {
              await writer.ready;
              await writer.write(encoder.encode(sseFrame(envelope)));
            })
            .catch(() => {
              subscriber.close();
            })
            .finally(() => {
              subscriber.pending -= 1;
            });
          return await subscriber.tail;
        },
        tail: Promise.resolve(),
        write: async (text) => {
          try {
            await writer.ready;
            await writer.write(encoder.encode(text));
          } catch {
            subscriber.close();
          }
        },
      };
      request?.signal.addEventListener("abort", subscriber.close, {
        once: true,
      });
      const replay = await replayJournal(
        this.env.DB,
        scoped,
        scoped.projectId,
        after
      );
      if (replay.expired) {
        const body = replay.events.map((event) => sseFrame(event)).join("");
        return new Response(encoder.encode(body), {
          headers: {
            "Cache-Control": "no-store",
            "Content-Type": "text/event-stream",
            "X-Accel-Buffering": "no",
          },
        });
      }
      for (const event of replay.events) {
        ignorePromise(subscriber.send(event));
      }
      this.subscribers.add(subscriber);
      heartbeat = setInterval(() => {
        ignorePromise(subscriber.write(": heartbeat\n\n"));
      }, CHANNEL_HEARTBEAT_MS);
      maxAge = setTimeout(() => {
        ignorePromise(
          subscriber.write(
            resetFrame(scoped, scoped.projectId, "stream_rotation")
          )
        );
        subscriber.close();
      }, CHANNEL_MAX_STREAM_MS);
      return new Response(stream.readable, {
        headers: {
          "Cache-Control": "no-store",
          "Content-Type": "text/event-stream",
          "X-Accel-Buffering": "no",
        },
      });
    });
  }

  async commitAndPublish(entry: Parameters<typeof commitJournalEntry>[2]) {
    const committed = await commitJournalEntry(this.env.DB, this.scope, entry);
    if (!(committed.inserted && committed.envelope)) {
      return committed.envelope;
    }
    await Promise.allSettled(
      [...this.subscribers].map((subscriber) =>
        subscriber.send(committed.envelope)
      )
    );
    return committed.envelope;
  }

  private async runDueDeadlines(now: number) {
    await this.initialized;
    let state = this.getState();
    const due = this.state.storage.sql
      .exec<DeadlineRow>(
        "SELECT kind, due_at FROM deadlines WHERE due_at <= ? ORDER BY due_at, kind",
        now
      )
      .toArray();
    for (const deadline of due) {
      if (
        (deadline.kind === "beat" && state.status === "paused") ||
        state.status === "closed"
      ) {
        continue;
      }
      // biome-ignore lint/performance/noAwaitInLoops: deadlines mutate one channel and must run in serialized order.
      const result = await this.runHook(deadline.kind, now);
      if (result?.status) {
        this.putState({ status: result.status });
        state = { status: result.status };
      }
      const checkpoints = result?.checkpoint ?? {};
      for (const [name, value] of Object.entries(checkpoints)) {
        this.putCheckpoint(name, value, now);
      }
      this.writeDeadline(deadline.kind, result?.rescheduleAt ?? null);
    }
    await this.rescheduleAlarm();
  }

  private async runHook(kind: DeadlineKind, now: number) {
    const checkpoints: Record<string, string> = {};
    const context: ChannelHookContext = {
      checkpoint: (name, value) => {
        checkpoints[name] = value;
      },
      commit: async (entry) => await this.commitAndPublish(entry),
      now,
      scope: this.scope,
    };
    const hook = this.hooks[kind] ?? this.defaultHook(kind);
    const result = await hook(context);
    const hookResult = result ?? {};
    return {
      ...hookResult,
      checkpoint: { ...checkpoints, ...hookResult.checkpoint },
    };
  }

  private defaultHook(kind: DeadlineKind): ChannelHook {
    if (kind !== "recovery") {
      return async () => undefined;
    }
    return async ({ now }) => {
      await this.env.DB.prepare(
        `UPDATE pm_processing
         SET status = 'pending', updated_at = ?
         WHERE workspace_id = ? AND channel = ? AND status = 'error'`
      )
        .bind(
          new Date(now).toISOString(),
          this.scope.workspaceId,
          this.scope.channel
        )
        .run();
      const pending = await this.env.DB.prepare(
        `SELECT COUNT(*) AS count FROM pm_processing
           WHERE workspace_id = ? AND channel = ?
             AND status IN ('pending', 'error')`
      )
        .bind(this.scope.workspaceId, this.scope.channel)
        .first<{ count: number }>();
      return {
        checkpoint: { pending_processing: String(pending?.count ?? 0) },
      };
    };
  }

  private requestScope(url: URL): ChannelRequestScope {
    return {
      channel: this.scope.channel,
      projectId: url.searchParams.get("project_id") ?? "default",
      workspaceId: this.scope.workspaceId,
      ...(url.searchParams.get("workflow_id")
        ? { workflowId: url.searchParams.get("workflow_id") ?? undefined }
        : {}),
    };
  }

  private getState(): CoordinatorState {
    const [row] = this.state.storage.sql
      .exec<{ value: string }>(
        "SELECT value FROM coordinator_state WHERE key = 'status'"
      )
      .toArray();
    return {
      status:
        row?.value === "paused"
          ? "paused"
          : ((row?.value as ChannelStatus) ?? "prepared"),
    };
  }

  private putState(state: CoordinatorState) {
    this.state.storage.sql.exec(
      `INSERT INTO coordinator_state(key, value)
       VALUES ('status', ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
      state.status
    );
  }

  private putCheckpoint(name: string, value: string, now: number) {
    this.state.storage.sql.exec(
      `INSERT INTO checkpoints(name, value, updated_at)
       VALUES (?, ?, ?)
       ON CONFLICT(name) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
      name,
      value,
      now
    );
  }

  private deadlines() {
    return Object.fromEntries(
      this.state.storage.sql
        .exec<DeadlineRow>("SELECT kind, due_at FROM deadlines")
        .toArray()
        .map((row) => [row.kind, row.due_at])
    ) as Partial<Record<DeadlineKind, number>>;
  }

  private writeDeadline(kind: DeadlineKind, dueAt: number | null) {
    if (dueAt === null) {
      this.state.storage.sql.exec("DELETE FROM deadlines WHERE kind = ?", kind);
    } else {
      this.state.storage.sql.exec(
        `INSERT INTO deadlines(kind, due_at)
         VALUES (?, ?)
         ON CONFLICT(kind) DO UPDATE SET due_at = excluded.due_at`,
        kind,
        dueAt
      );
    }
  }

  private async rescheduleAlarm() {
    const { status } = this.getState();
    const rows = this.state.storage.sql
      .exec<DeadlineRow>("SELECT kind, due_at FROM deadlines ORDER BY due_at")
      .toArray()
      .filter((row) => !(row.kind === "beat" && status === "paused"));
    const next = rows[0]?.due_at;
    if (next === undefined || status === "closed") {
      await this.state.storage.deleteAlarm();
    } else {
      await this.state.storage.setAlarm(next);
    }
  }

  private initializeStorage() {
    this.state.storage.sql.exec(
      "CREATE TABLE IF NOT EXISTS coordinator_state(key TEXT PRIMARY KEY, value TEXT NOT NULL)"
    );
    this.state.storage.sql.exec(
      "CREATE TABLE IF NOT EXISTS deadlines(kind TEXT PRIMARY KEY, due_at INTEGER NOT NULL)"
    );
    this.state.storage.sql.exec(
      "CREATE TABLE IF NOT EXISTS checkpoints(name TEXT PRIMARY KEY, value TEXT NOT NULL, updated_at INTEGER NOT NULL)"
    );
    if (!this.getState().status) {
      this.putState({ status: "prepared" });
    }
  }

  private async serialized<T>(work: () => Promise<T>) {
    const run = this.queue.then(async () => {
      await this.initialized;
      return await work();
    });
    this.queue = run.then(
      () => undefined,
      () => undefined
    );
    return await run;
  }
}

export class ChannelCoordinator extends DurableObjectBase {
  private readonly core: ChannelCoordinatorCore;

  constructor(state: DurableObjectState, env: ChannelCoordinatorBindings) {
    super(state, env);
    const [workspaceId = "unknown", channel = "unknown"] = (
      state.id.name ?? "unknown:unknown"
    ).split(":");
    this.core = new ChannelCoordinatorCore(state, env, {
      channel,
      workspaceId,
    });
  }

  async alarm() {
    await this.core.alarm();
  }

  async fetch(request: Request) {
    return await this.core.fetch(request);
  }
}
