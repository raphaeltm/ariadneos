import { describe, expect, it } from "vitest";
import {
  designedGraphFromBundle,
  kbSummary,
  loadKb,
  readAuthoredKbNodes,
  readDesignedGraph,
  readKbState,
  seedKb,
} from "../server/kb.ts";

interface StoredRow {
  observed_occurrences?: number;
  observed_support?: number;
  payload: string;
  rank?: number;
  source: string;
  weight?: number;
}

class FakeD1Database {
  readonly activities = new Map<string, StoredRow>();
  readonly follows = new Map<string, StoredRow>();
  readonly nodes = new Map<string, StoredRow>();
  state: {
    source: string;
    state_hash: string;
    summary_json: string;
    updated_at: string;
  } | null = null;

  batch(statements: FakeD1Statement[]) {
    for (const statement of statements) {
      this.apply(statement);
    }
    return [];
  }

  prepare(sql: string) {
    const unbound = new FakeD1Statement(this, sql, []);
    return {
      all: () => unbound.all(),
      bind: (...bindings: (null | number | string)[]) =>
        new FakeD1Statement(this, sql, bindings),
      first: () => unbound.first(),
    };
  }

  private apply(statement: FakeD1Statement) {
    if (statement.sql.includes("pm_kb_nodes")) {
      const [kind, id, source, payload] = statement.bindings;
      const key = `${kind}:${id}`;
      const existing = this.nodes.get(key);
      if (existing && existing.source !== "authored") {
        return;
      }
      this.nodes.set(key, { payload: String(payload), source: String(source) });
      return;
    }
    if (statement.sql.includes("pm_kb_workflow_activities")) {
      const [workflowId, activityId, source, rank, payload] =
        statement.bindings;
      const key = `${workflowId}:${activityId}`;
      const existing = this.activities.get(key);
      if (existing && existing.source !== "authored") {
        return;
      }
      this.activities.set(key, {
        observed_occurrences: 0,
        observed_support: 0,
        payload: String(payload),
        rank: Number(rank),
        source: String(source),
      });
      return;
    }
    if (statement.sql.includes("pm_kb_workflow_follows")) {
      const [
        workflowId,
        fromActivityId,
        toActivityId,
        source,
        weight,
        payload,
      ] = statement.bindings;
      const key = `${workflowId}:${fromActivityId}:${toActivityId}`;
      const existing = this.follows.get(key);
      if (existing && existing.source !== "authored") {
        return;
      }
      this.follows.set(key, {
        observed_occurrences: 0,
        observed_support: 0,
        payload: String(payload),
        source: String(source),
        weight: Number(weight),
      });
      return;
    }
    if (statement.sql.includes("pm_kb_state")) {
      const [source, stateHash, summaryJson, updatedAt] = statement.bindings;
      this.state = {
        source: String(source),
        state_hash: String(stateHash),
        summary_json: String(summaryJson),
        updated_at: String(updatedAt),
      };
    }
  }
}

class FakeD1Statement {
  readonly bindings: (null | number | string)[];
  private readonly db: FakeD1Database;
  readonly sql: string;

  constructor(
    db: FakeD1Database,
    sql: string,
    bindings: (null | number | string)[]
  ) {
    this.bindings = bindings;
    this.db = db;
    this.sql = sql;
  }

  all() {
    if (this.sql.includes("FROM pm_kb_nodes")) {
      return {
        results: [...this.db.nodes.entries()]
          .filter(([, row]) => row.source === "authored")
          .map(([key, row]) => {
            const [kind, id] = key.split(":");
            return { id, kind, payload: row.payload };
          })
          .sort((left, right) =>
            `${left.kind}:${left.id}`.localeCompare(`${right.kind}:${right.id}`)
          ),
      };
    }
    if (this.sql.includes("FROM pm_kb_workflow_activities")) {
      const workflowId = String(this.bindings[0]);
      return {
        results: [...this.db.activities.entries()]
          .filter(
            ([key, row]) =>
              key.startsWith(`${workflowId}:`) && row.source === "authored"
          )
          .map(([, row]) => row)
          .sort((left, right) => (left.rank ?? 0) - (right.rank ?? 0)),
      };
    }
    if (this.sql.includes("FROM pm_kb_workflow_follows")) {
      const workflowId = String(this.bindings[0]);
      return {
        results: [...this.db.follows.entries()]
          .filter(
            ([key, row]) =>
              key.startsWith(`${workflowId}:`) && row.source === "authored"
          )
          .map(([, row]) => row),
      };
    }
    return { results: [] };
  }

  first() {
    if (this.sql.includes("FROM pm_kb_state")) {
      return this.db.state;
    }
    const workflowId = String(this.bindings[0]);
    return this.db.nodes.get(`workflow:${workflowId}`) ?? null;
  }
}

const asD1 = (db: FakeD1Database) => db as unknown as D1Database;

describe("authored KB bundle", () => {
  it("loads the required authored organization records", () => {
    expect(kbSummary()).toMatchObject({
      artifacts: 10,
      people: 6,
      policies: 5,
      projects: 2,
      roleCapabilities: 6,
      workflows: 5,
      workspaces: 1,
    });
  });

  it("validates Helios and Atlas matrix dimensions and scoped IDs", () => {
    const helios = designedGraphFromBundle("wf_p1_incident");
    const atlas = designedGraphFromBundle("wf_feature_intake");
    expect(helios?.activities).toHaveLength(11);
    expect(helios?.matrix).toHaveLength(11);
    expect(helios?.matrix.every((row) => row.length === 11)).toBe(true);
    expect(atlas?.activities).toHaveLength(8);
    expect(atlas?.matrix).toHaveLength(8);
    expect(atlas?.matrix.every((row) => row.length === 8)).toBe(true);
    expect(helios?.projectId).toBe("proj_helios");
    expect(atlas?.projectId).toBe("proj_atlas");
    expect(helios?.policyIds).toEqual([
      "pol_sec_review",
      "pol_credit_approval",
      "pol_postmortem",
    ]);
    expect(atlas?.policyIds).toEqual([
      "pol_roadmap_review",
      "pol_exec_threshold",
    ]);
  });

  it("keeps legacy access security review in designed inputs", () => {
    const access = designedGraphFromBundle("legacy_access");
    expect(access?.activities.map((activity) => activity.slug)).toContain(
      "security_review"
    );
    expect(access?.edges.every((edge) => edge.observedSupport === 0)).toBe(
      true
    );
  });

  it("traces workspace deviations to agendas or process beliefs", () => {
    const [workspace] = loadKb().workspaces;
    expect(workspace?.expected_deviations.map((item) => item.slug)).toEqual([
      "escalate_to_ceo",
      "improvise_hotfix",
      "security_review",
      "hold_customer_call",
    ]);
  });
});

describe("KB D1 helpers", () => {
  it("seeds idempotently while preserving non-authored rows", async () => {
    const db = new FakeD1Database();
    db.nodes.set("policy:pol_curated_only", {
      payload: JSON.stringify({ id: "pol_curated_only" }),
      source: "curated",
    });
    const first = await seedKb(asD1(db), "2026-09-12T00:00:00.000Z");
    const firstMembership = authoredMembership(db);
    const second = await seedKb(asD1(db), "2026-09-12T00:01:00.000Z");
    expect(authoredMembership(db)).toEqual(firstMembership);
    expect(second.stateHash).toBe(first.stateHash);
    expect(db.nodes.get("policy:pol_curated_only")?.source).toBe("curated");
  });

  it("persists a single authored KB state row", async () => {
    const db = new FakeD1Database();
    const result = await seedKb(asD1(db), "2026-09-12T00:00:00.000Z");
    await seedKb(asD1(db), "2026-09-12T00:00:00.000Z");
    const state = await readKbState(asD1(db));

    expect(state).toMatchObject({
      source: "authored",
      stateHash: result.stateHash,
      summary: { people: 6, workflows: 5 },
    });
  });

  it("reads designed graph inputs with zero observations", async () => {
    const db = new FakeD1Database();
    await seedKb(asD1(db), "2026-09-12T00:00:00.000Z");
    const graph = await readDesignedGraph(asD1(db), "wf_p1_incident");
    expect(graph?.activities).toHaveLength(11);
    expect(graph?.edges.length).toBeGreaterThan(0);
    expect(
      graph?.activities.every(
        (activity) =>
          activity.observedOccurrences === 0 && activity.observedSupport === 0
      )
    ).toBe(true);
    expect(
      graph?.edges.every(
        (edge) => edge.observedOccurrences === 0 && edge.observedSupport === 0
      )
    ).toBe(true);
  });

  it("reads authored nodes separately from workflow memberships", async () => {
    const db = new FakeD1Database();
    await seedKb(asD1(db), "2026-09-12T00:00:00.000Z");
    const nodes = await readAuthoredKbNodes(asD1(db));
    expect(nodes.filter((node) => node.kind === "person")).toHaveLength(6);
    expect(nodes.filter((node) => node.kind === "workflow")).toHaveLength(5);
  });
});

function authoredMembership(db: FakeD1Database) {
  return {
    activities: [...db.activities.entries()]
      .filter(([, row]) => row.source === "authored")
      .map(([key]) => key)
      .sort((left, right) => left.localeCompare(right)),
    follows: [...db.follows.entries()]
      .filter(([, row]) => row.source === "authored")
      .map(([key]) => key)
      .sort((left, right) => left.localeCompare(right)),
    nodes: [...db.nodes.entries()]
      .filter(([, row]) => row.source === "authored")
      .map(([key]) => key)
      .sort((left, right) => left.localeCompare(right)),
  };
}
