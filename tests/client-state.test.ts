import { describe, expect, it } from "vitest";
import {
  createClientFixtures,
  createFixtureApiAdapter,
  type JournalEvent,
} from "../src/api.ts";
import {
  backoffDelay,
  createSseClient,
  type EventSourceLike,
} from "../src/sse.ts";
import {
  applyJournalEvent,
  applySnapshot,
  beginSnapshotLoad,
  createInitialState,
  selectCurrentGraph,
  selectMessagesForSession,
  selectProject,
} from "../src/store.ts";

describe("typed snapshot store", () => {
  it("converges to the same state from fresh snapshot or disconnect replay", () => {
    const fixtures = createClientFixtures();
    const fresh = applySnapshot(
      createInitialState(fixtures.scope),
      fixtures.finalSnapshot,
      fixtures.scope
    );
    const replayed = fixtures.replay.reduce(
      (state, event) => applyJournalEvent(state, event).state,
      applySnapshot(
        createInitialState(fixtures.scope),
        fixtures.baseSnapshot,
        fixtures.scope
      )
    );
    expect(comparable(replayed)).toEqual(comparable(fresh));
  });

  it("ignores duplicate journal events", () => {
    const fixtures = createClientFixtures();
    const replayed = fixtures.duplicateReplay.reduce(
      (state, event) => applyJournalEvent(state, event).state,
      applySnapshot(
        createInitialState(fixtures.scope),
        fixtures.baseSnapshot,
        fixtures.scope
      )
    );
    expect(replayed.appliedEventIds).toEqual([100, 101, 102, 103]);
    expect(comparable(replayed)).toEqual(
      comparable(
        applySnapshot(
          createInitialState(fixtures.scope),
          fixtures.finalSnapshot,
          fixtures.scope
        )
      )
    );
  });

  it("removes rejected discovered nodes and updates designed activities back to ghosts", () => {
    const fixtures = createClientFixtures();
    const replayed = fixtures.replay.reduce(
      (state, event) => applyJournalEvent(state, event).state,
      applySnapshot(
        createInitialState(fixtures.scope),
        fixtures.baseSnapshot,
        fixtures.scope
      )
    );
    const graph = selectCurrentGraph(replayed);
    expect(
      graph?.nodes.find((node) => node.id === "act_hold_customer_call")
    ).toBeUndefined();
    expect(graph?.edges.some((edge) => edge.id === "ged_hotfix_call")).toBe(
      false
    );
    expect(
      graph?.nodes.find((node) => node.id === "act_security_review")?.activity
    ).toMatchObject({
      plane: "designed",
      support: 0,
    });
    expect(
      graph?.edges.some(
        (edge) =>
          edge.from === "act_hold_customer_call" ||
          edge.to === "act_hold_customer_call"
      )
    ).toBe(false);
  });

  it("ignores stale snapshot completions and stale project events", () => {
    const fixtures = createClientFixtures();
    const requestState = beginSnapshotLoad(
      createInitialState(fixtures.scope),
      fixtures.scope,
      "request-new"
    );
    const staleComplete = applySnapshot(
      requestState,
      fixtures.finalSnapshot,
      fixtures.scope,
      "request-old"
    );
    expect(selectCurrentGraph(staleComplete)).toBeNull();
    const switched = applySnapshot(
      createInitialState(
        selectProject(requestState, "proj_atlas", "wf_feature_intake").scope
      ),
      fixtures.atlasSnapshot,
      {
        ...fixtures.scope,
        project_id: "proj_atlas",
        workflow_id: "wf_feature_intake",
      }
    );
    const ignored = applyJournalEvent(
      switched,
      fixtures.replay[0] as JournalEvent
    );
    expect(ignored.state.connection.lastEventId).toBe(
      fixtures.atlasSnapshot.cursor
    );
    expect(
      selectMessagesForSession(ignored.state, "ses_helios_skip_review")
    ).toEqual([]);
  });

  it("requests a fresh snapshot on graph revision mismatch", () => {
    const fixtures = createClientFixtures();
    const state = applySnapshot(
      createInitialState(fixtures.scope),
      fixtures.baseSnapshot,
      fixtures.scope
    );
    const result = applyJournalEvent(state, fixtures.revisionMismatch);
    expect(result.effect).toEqual({
      kind: "snapshot_required",
      reason: "revision_mismatch",
    });
    expect(result.state.connection.status).toBe("resyncing");
    expect(result.state.connection.lastEventId).toBe(104);
  });
});

describe("api and SSE adapters", () => {
  it("keeps fixture and production API adapters behind the same contract", async () => {
    const fixtures = createClientFixtures();
    const adapter = createFixtureApiAdapter(fixtures);
    await expect(
      adapter.fetchSnapshot({ scope: fixtures.scope })
    ).resolves.toMatchObject({
      cursor: 103,
      graph: { revision: 8 },
    });
    expect(adapter.buildStreamUrl(fixtures.scope, 103)).toContain("after=103");
  });

  it("uses explicit after cursors, ignores duplicate messages, and cleans up hidden streams", () => {
    const fixtures = createClientFixtures();
    const events: JournalEvent[] = [];
    const document = new FakeDocument();
    FakeEventSource.current = null;
    const client = createSseClient({
      adapter: createFixtureApiAdapter(fixtures),
      after: 100,
      document,
      eventSource: FakeEventSource,
      onEvent: (event) => events.push(event),
      scope: fixtures.scope,
      timers: immediateTimers(),
    });
    client.start();
    const source = FakeEventSource.current as unknown as FakeEventSource | null;
    if (!source) {
      throw new Error("Expected EventSource to be created.");
    }
    expect(source.url).toContain("after=100");
    source?.emit(fixtures.replay[0] as JournalEvent);
    source?.emit(fixtures.replay[0] as JournalEvent);
    expect(events).toHaveLength(1);
    document.hidden = true;
    document.fire();
    expect(source?.closed).toBe(true);
    expect(client.getState().status).toBe("hidden");
  });

  it("caps reconnect backoff", () => {
    expect(backoffDelay(1, { baseMs: 100, maxMs: 250 })).toBe(100);
    expect(backoffDelay(4, { baseMs: 100, maxMs: 250 })).toBe(250);
  });
});

function comparable(state: ReturnType<typeof createInitialState>) {
  const graph = selectCurrentGraph(state);
  return {
    graph: {
      edges: graph?.edges.map((edge) => edge.id).sort(),
      nodes: graph?.nodes
        .map((node) => ({
          id: node.id,
          plane: node.activity.plane,
          support: node.activity.support,
        }))
        .sort((a, b) => a.id.localeCompare(b.id)),
      revision: graph?.revision,
    },
    messages: Object.keys(state.messages).sort(),
    steps: Object.values(state.steps)
      .map((step) => [step.id, step.status])
      .sort(([a], [b]) => String(a).localeCompare(String(b))),
  };
}

class FakeDocument {
  hidden = false;
  private listener: (() => void) | null = null;

  addEventListener(_event: "visibilitychange", listener: () => void) {
    this.listener = listener;
  }

  fire() {
    this.listener?.();
  }

  removeEventListener(_event: "visibilitychange", listener: () => void) {
    if (this.listener === listener) {
      this.listener = null;
    }
  }
}

class FakeEventSource implements EventSourceLike {
  static current: FakeEventSource | null = null;

  closed = false;
  onerror: ((event: Event) => void) | null = null;
  onmessage: ((event: MessageEvent<string>) => void) | null = null;
  onopen: ((event: Event) => void) | null = null;
  readonly url: string;

  constructor(url: string) {
    this.url = url;
    FakeEventSource.current = this;
  }

  close = () => {
    this.closed = true;
  };

  emit(event: JournalEvent) {
    this.onmessage?.({ data: JSON.stringify(event) } as MessageEvent<string>);
  }
}

function immediateTimers() {
  return {
    clearTimeout: () => undefined,
    setTimeout: (callback: () => void) => {
      callback();
      return 1 as unknown as ReturnType<typeof setTimeout>;
    },
  };
}
