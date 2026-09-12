import type {
  ApiAdapter,
  ConnectionScope,
  JournalEvent,
  JournalId,
} from "./api.ts";

export interface EventSourceLike {
  close: () => void;
  onerror: ((event: Event) => void) | null;
  onmessage: ((event: MessageEvent<string>) => void) | null;
  onopen: ((event: Event) => void) | null;
}

export interface EventSourceConstructor {
  new (url: string): EventSourceLike;
}

export interface SseClientOptions {
  adapter: Pick<ApiAdapter, "buildStreamUrl">;
  after?: JournalId;
  backoff?: {
    baseMs?: number;
    jitterMs?: number;
    maxMs?: number;
  };
  document?: VisibilityDocument;
  eventSource?: EventSourceConstructor;
  onEvent: (event: JournalEvent) => void;
  onSnapshotRequired?: (reason: string) => void;
  onState?: (state: SseState) => void;
  scope: ConnectionScope;
  timers?: TimerApi;
}

export interface VisibilityDocument {
  addEventListener: (type: "visibilitychange", listener: () => void) => void;
  hidden: boolean;
  removeEventListener: (type: "visibilitychange", listener: () => void) => void;
}

export interface SseState {
  attempt: number;
  lastEventId: JournalId | null;
  nextDelayMs: number | null;
  status: "closed" | "connecting" | "hidden" | "live" | "reconnecting";
  url: string | null;
}

export interface TimerApi {
  clearTimeout: (handle: ReturnType<typeof setTimeout>) => void;
  setTimeout: (
    callback: () => void,
    delayMs: number
  ) => ReturnType<typeof setTimeout>;
}

export interface SseClient {
  getState: () => SseState;
  reconnect: (after?: JournalId) => void;
  resetScope: (scope: ConnectionScope, after?: JournalId) => void;
  start: () => void;
  stop: () => void;
}

export function createSseClient(options: SseClientOptions): SseClient {
  const { scope: initialScope } = options;
  const timers = options.timers ?? {
    clearTimeout: clearTimeout.bind(globalThis),
    setTimeout: setTimeout.bind(globalThis),
  };
  const EventSourceImpl = options.eventSource ?? globalThis.EventSource;
  let scope = initialScope;
  let source: EventSourceLike | null = null;
  let retryHandle: ReturnType<typeof setTimeout> | null = null;
  let stopped = true;
  let state: SseState = {
    attempt: 0,
    lastEventId: options.after ?? null,
    nextDelayMs: null,
    status: "closed",
    url: null,
  };
  const update = (patch: Partial<SseState>) => {
    state = { ...state, ...patch };
    options.onState?.(state);
  };
  const cleanupSource = () => {
    if (source) {
      source.close();
      source = null;
    }
  };
  const clearRetry = () => {
    if (retryHandle) {
      timers.clearTimeout(retryHandle);
      retryHandle = null;
    }
  };
  const connect = (after?: JournalId) => {
    if (stopped) {
      return;
    }
    if (options.document?.hidden) {
      cleanupSource();
      update({ nextDelayMs: null, status: "hidden", url: null });
      return;
    }
    cleanupSource();
    clearRetry();
    const cursor = after ?? state.lastEventId ?? undefined;
    const url = options.adapter.buildStreamUrl(scope, cursor);
    update({ nextDelayMs: null, status: "connecting", url });
    source = new EventSourceImpl(url);
    source.onopen = () => {
      update({ attempt: 0, nextDelayMs: null, status: "live" });
    };
    source.onmessage = (message) => {
      const event = JSON.parse(message.data) as JournalEvent;
      if (!eventMatchesScope(scope, event)) {
        return;
      }
      if (state.lastEventId !== null && event.id <= state.lastEventId) {
        return;
      }
      update({ lastEventId: event.id, status: "live" });
      if (event.kind === "reset") {
        options.onSnapshotRequired?.(event.payload.reason);
      }
      options.onEvent(event);
    };
    source.onerror = () => {
      scheduleReconnect();
    };
  };
  const scheduleReconnect = () => {
    if (stopped) {
      return;
    }
    cleanupSource();
    const attempt = state.attempt + 1;
    const delayMs = backoffDelay(attempt, options.backoff);
    update({ attempt, nextDelayMs: delayMs, status: "reconnecting" });
    retryHandle = timers.setTimeout(() => {
      retryHandle = null;
      connect(state.lastEventId ?? undefined);
    }, delayMs);
  };
  const onVisibility = () => {
    if (options.document?.hidden) {
      cleanupSource();
      clearRetry();
      update({ nextDelayMs: null, status: "hidden", url: null });
      return;
    }
    connect(state.lastEventId ?? undefined);
  };
  return {
    getState: () => state,
    reconnect: (after) => {
      update({ lastEventId: after ?? state.lastEventId });
      connect(after);
    },
    resetScope: (nextScope, after) => {
      scope = nextScope;
      update({
        attempt: 0,
        lastEventId: after ?? null,
        nextDelayMs: null,
        status: "closed",
      });
      connect(after);
    },
    start: () => {
      if (!EventSourceImpl) {
        throw new Error("EventSource is not available in this environment.");
      }
      if (!stopped) {
        return;
      }
      stopped = false;
      options.document?.addEventListener("visibilitychange", onVisibility);
      connect(state.lastEventId ?? undefined);
    },
    stop: () => {
      stopped = true;
      cleanupSource();
      clearRetry();
      options.document?.removeEventListener("visibilitychange", onVisibility);
      update({ nextDelayMs: null, status: "closed", url: null });
    },
  };
}

export function backoffDelay(
  attempt: number,
  options: SseClientOptions["backoff"] = {}
): number {
  const baseMs = options.baseMs ?? 1000;
  const jitterMs = options.jitterMs ?? 0;
  const maxMs = options.maxMs ?? 30_000;
  const exponential = baseMs * 2 ** Math.max(0, attempt - 1);
  return Math.min(maxMs, exponential + jitterMs);
}

function eventMatchesScope(scope: ConnectionScope, event: JournalEvent) {
  return (
    event.channel === scope.channel &&
    event.project_id === scope.project_id &&
    event.workspace_id === scope.workspace_id
  );
}
