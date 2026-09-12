import { performance } from "node:perf_hooks";
import { describe, expect, it } from "vitest";
import {
  buildAggregateGraph,
  type DesignedWorkflowInput,
  diffAggregateGraphs,
  type MiningSessionInput,
  type MiningStepInput,
} from "../shared/mining/graph.ts";
import {
  buildLayoutData,
  layoutIsAcyclic,
} from "../shared/mining/layout-data.ts";

const heliosWorkflow: DesignedWorkflowInput = {
  activities: [
    { label: "Detect incident", rank: 0, slug: "detect_incident" },
    { label: "Triage incident", rank: 1, slug: "triage_incident" },
    { label: "Security review", rank: 2, slug: "security_review" },
    { label: "Deploy fix", rank: 3, slug: "deploy_fix" },
  ],
  edges: [
    {
      probability: 1,
      sourceActivitySlug: "detect_incident",
      targetActivitySlug: "triage_incident",
    },
    {
      probability: 0.85,
      sourceActivitySlug: "triage_incident",
      targetActivitySlug: "security_review",
    },
    {
      probability: 0.95,
      sourceActivitySlug: "security_review",
      targetActivitySlug: "deploy_fix",
    },
  ],
  entryActivitySlug: "detect_incident",
  exitActivitySlugs: ["deploy_fix"],
  id: "wf_helios",
  projectId: "proj_helios",
};

const atlasWorkflow: DesignedWorkflowInput = {
  activities: [
    { rank: 0, slug: "detect_incident" },
    { rank: 1, slug: "triage_incident" },
  ],
  edges: [
    {
      sourceActivitySlug: "detect_incident",
      targetActivitySlug: "triage_incident",
    },
  ],
  id: "wf_atlas",
  projectId: "proj_atlas",
};

const sessions: MiningSessionInput[] = [
  { id: "ses_h1", projectId: "proj_helios", workflowId: "wf_helios" },
  { id: "ses_h2", projectId: "proj_helios", workflowId: "wf_helios" },
  { id: "ses_a1", projectId: "proj_atlas", workflowId: "wf_atlas" },
];

function step(
  id: string,
  sessionId: string,
  seq: number,
  activitySlug: string,
  overrides: Partial<MiningStepInput> = {}
): MiningStepInput {
  return {
    activitySlug,
    actorPersonId: "per_priya",
    actorRole: "support",
    curation: "confirmed",
    evidence: [`${id}.000100`],
    id,
    lifecycle: "done",
    seq,
    sessionId,
    tsEnd: `2026-09-12T00:${String(seq).padStart(2, "0")}:20.000Z`,
    tsStart: `2026-09-12T00:${String(seq).padStart(2, "0")}:00.000Z`,
    type: "action",
    ...overrides,
  };
}

describe("deterministic aggregate graph mining", () => {
  it("scopes support by project while repeated visits only increase occurrences", () => {
    const graph = buildAggregateGraph({
      scope: { projectId: "proj_helios", workflowId: "wf_helios" },
      sessions,
      steps: [
        step("h1-1", "ses_h1", 1, "detect_incident"),
        step("h1-2", "ses_h1", 2, "triage_incident"),
        step("h1-3", "ses_h1", 3, "detect_incident"),
        step("h1-4", "ses_h1", 4, "deploy_fix"),
        step("a1-1", "ses_a1", 1, "detect_incident"),
        step("a1-2", "ses_a1", 2, "triage_incident"),
      ],
      workflows: [heliosWorkflow, atlasWorkflow],
    });

    const detect = graph.nodes.find((node) => node.slug === "detect_incident");
    expect(detect).toMatchObject({
      occurrences: 2,
      plane: "both",
      support: 1,
    });
    expect(graph.stats.sessions).toBe(1);
    expect(graph.instanceGraph.nodes.map((node) => node.sessionId)).toEqual([
      "ses_h1",
      "ses_h1",
      "ses_h1",
      "ses_h1",
    ]);
    expect(
      graph.edges.find(
        (edge) =>
          edge.source === "act_triage_incident" &&
          edge.target === "act_detect_incident"
      )
    ).toMatchObject({ isBackEdge: true, kind: "rework", occurrences: 1 });
  });

  it("only mines done confirmed non-negated steps", () => {
    const graph = buildAggregateGraph({
      sessions,
      steps: [
        step("done", "ses_h1", 1, "detect_incident"),
        step("proposed", "ses_h1", 2, "triage_incident", {
          curation: "proposed",
        }),
        step("rejected", "ses_h1", 3, "security_review", {
          curation: "rejected",
        }),
        step("skipped", "ses_h1", 4, "deploy_fix", { lifecycle: "skipped" }),
        step("negated", "ses_h1", 5, "improvise_hotfix", {
          lifecycle: "done",
          modality: "negated",
        }),
        step("abandoned", "ses_h1", 6, "write_postmortem", {
          lifecycle: "abandoned",
        }),
      ],
      workflows: [heliosWorkflow],
    });

    expect(graph.stats.acceptedSteps).toBe(1);
    expect(
      graph.nodes.find((node) => node.slug === "detect_incident")?.support
    ).toBe(1);
    expect(
      graph.nodes.find((node) => node.slug === "improvise_hotfix")
    ).toBeUndefined();
    expect(
      graph.nodes.find((node) => node.slug === "security_review")
    ).toMatchObject({ occurrences: 0, plane: "designed" });
  });

  it("applies edge kind precedence deterministically", () => {
    const graph = buildAggregateGraph({
      sessions: [
        { id: "approval", projectId: "proj_helios" },
        { id: "decision", projectId: "proj_helios" },
        { id: "handoff", projectId: "proj_helios" },
        { id: "rework", projectId: "proj_helios" },
      ],
      steps: [
        step("ap-1", "approval", 1, "decide_path", {
          actorPersonId: "per_priya",
          type: "decision",
        }),
        step("ap-2", "approval", 2, "exec_approval", {
          actorPersonId: "per_dana",
          type: "approval",
        }),
        step("de-1", "decision", 1, "triage_incident", {
          actorPersonId: "per_priya",
          type: "decision",
        }),
        step("de-2", "decision", 2, "deploy_fix", {
          actorPersonId: "per_tom",
        }),
        step("ha-1", "handoff", 1, "assign_owner", {
          actorPersonId: "per_priya",
        }),
        step("ha-2", "handoff", 2, "root_cause_analysis", {
          actorPersonId: "per_tom",
        }),
        step("rw-1", "rework", 1, "security_review", {
          actorPersonId: "per_tom",
        }),
        step("rw-2", "rework", 2, "deploy_fix", {
          actorPersonId: "per_tom",
        }),
        step("rw-3", "rework", 3, "security_review", {
          actorPersonId: "per_dana",
          type: "approval",
        }),
      ],
    });

    const kindById = new Map(graph.edges.map((edge) => [edge.id, edge.kind]));
    expect(kindById.get("act_decide_path::act_exec_approval")).toBe("approval");
    expect(kindById.get("act_triage_incident::act_deploy_fix")).toBe(
      "decision"
    );
    expect(kindById.get("act_assign_owner::act_root_cause_analysis")).toBe(
      "handoff"
    );
    expect(kindById.get("act_deploy_fix::act_security_review")).toBe("rework");
  });

  it("returns discovered nodes to deletion or designed ghosts after rejection", () => {
    const initial = buildAggregateGraph({
      sessions,
      steps: [
        step("h1-1", "ses_h1", 1, "detect_incident"),
        step("h1-extra", "ses_h1", 2, "improvise_hotfix"),
      ],
      workflows: [heliosWorkflow],
    });
    const afterRejection = buildAggregateGraph({
      sessions,
      steps: [
        step("h1-1", "ses_h1", 1, "detect_incident", {
          curation: "rejected",
        }),
        step("h1-extra", "ses_h1", 2, "improvise_hotfix", {
          curation: "rejected",
        }),
      ],
      workflows: [heliosWorkflow],
    });
    const diff = diffAggregateGraphs(initial, afterRejection);

    expect(
      afterRejection.nodes.find((node) => node.slug === "improvise_hotfix")
    ).toBeUndefined();
    expect(
      afterRejection.nodes.find((node) => node.slug === "detect_incident")
    ).toMatchObject({ occurrences: 0, plane: "designed", support: 0 });
    expect(diff.removed.nodes.map((node) => node.slug)).toContain(
      "improvise_hotfix"
    );
    expect(diff.updated.nodes.map((node) => node.slug)).toContain(
      "detect_incident"
    );
  });

  it("builds initial diffs and tolerates incomplete timing evidence", () => {
    const matrixWorkflow: DesignedWorkflowInput = {
      activities: [
        { id: "act_a", rank: 0, slug: "start_case" },
        { id: "act_b", rank: 1, slug: "branch_one" },
        { id: "act_c", rank: 2, slug: "branch_two" },
      ],
      entryActivityId: "act_a",
      exitActivityIds: ["act_b", "act_c"],
      id: "wf_matrix",
      matrix: [
        [0, 0.4, 0.6],
        [0, 0, 0],
        [0, 0, 0],
      ],
      projectId: "proj_helios",
    };
    const graph = buildAggregateGraph({
      scope: { workflowId: "wf_matrix" },
      sessions: [
        { id: "ses_matrix", projectId: "proj_helios", workflowId: "wf_matrix" },
      ],
      steps: [
        step("mx-1", "ses_matrix", 1, "start_case", {
          activityId: "act_a",
          evidence: ["2", "1"],
          tsEnd: null,
          tsStart: null,
          workflowId: "wf_matrix",
        }),
        step("mx-2", "ses_matrix", 2, "branch_one", {
          activityId: "act_b",
          tsEnd: "not-a-date",
          tsStart: "2026-09-12T00:02:00.000Z",
          workflowId: "wf_matrix",
        }),
      ],
      workflows: [matrixWorkflow],
    });
    const initialDiff = diffAggregateGraphs(null, graph);

    expect(initialDiff.added.nodes).toHaveLength(3);
    expect(
      graph.edges.find((edge) => edge.id === "act_a::act_c")
    ).toMatchObject({ designedProbability: 0.6, plane: "designed" });
    expect(graph.happyPath.map((pathStep) => pathStep.slug)).toEqual([
      "start_case",
      "branch_one",
    ]);
    expect(
      graph.nodes.find((node) => node.slug === "branch_one")?.avgDwellSeconds
    ).toBeNull();

    const roleGraph = buildAggregateGraph({
      sessions: [
        { id: "ses_role_1", projectId: "proj_helios" },
        { id: "ses_role_2", projectId: "proj_helios" },
      ],
      steps: [
        step("role-1", "ses_role_1", 1, "shared_activity", {
          actorRole: "support",
        }),
        step("role-2", "ses_role_2", 1, "shared_activity", {
          actorRole: "eng",
        }),
      ],
    });
    expect(
      roleGraph.nodes.find((node) => node.slug === "shared_activity")?.roles
    ).toEqual([
      { count: 1, role: "eng" },
      { count: 1, role: "support" },
    ]);
  });

  it("produces an acyclic deterministic layout with rework as annotation", () => {
    const graph = buildAggregateGraph({
      sessions,
      steps: [
        step("h1-1", "ses_h1", 1, "detect_incident"),
        step("h1-2", "ses_h1", 2, "triage_incident"),
        step("h1-3", "ses_h1", 3, "detect_incident"),
        step("h1-4", "ses_h1", 4, "deploy_fix"),
      ],
      workflows: [heliosWorkflow],
    });
    const firstLayout = buildLayoutData(graph);
    const secondLayout = buildLayoutData(graph);

    expect(layoutIsAcyclic(firstLayout)).toBe(true);
    expect(firstLayout).toEqual(secondLayout);
    expect(firstLayout.backEdges.map((edge) => edge.kind)).toContain("rework");
    expect(firstLayout.edges.some((edge) => edge.kind === "rework")).toBe(
      false
    );
    expect(
      layoutIsAcyclic({
        backEdges: [],
        edges: [
          {
            id: "a::b",
            kind: "sequence",
            occurrences: 1,
            plane: "discovered",
            probability: 1,
            source: "a",
            support: 1,
            target: "b",
          },
          {
            id: "b::a",
            kind: "sequence",
            occurrences: 1,
            plane: "discovered",
            probability: 1,
            source: "b",
            support: 1,
            target: "a",
          },
        ],
        nodes: [
          {
            height: 72,
            id: "a",
            label: "A",
            occurrences: 1,
            order: 0,
            plane: "discovered",
            rank: 0,
            reworkRate: 0,
            support: 1,
            width: 188,
            x: 0,
            y: 0,
          },
          {
            height: 72,
            id: "b",
            label: "B",
            occurrences: 1,
            order: 1,
            plane: "discovered",
            rank: 1,
            reworkRate: 0,
            support: 1,
            width: 188,
            x: 260,
            y: 0,
          },
        ],
      })
    ).toBe(false);

    const twoRootLayout = buildLayoutData(
      buildAggregateGraph({
        steps: [],
        workflows: [
          {
            activities: [{ slug: "alpha_root" }, { slug: "beta_root" }],
            id: "wf_roots",
          },
        ],
      })
    );
    expect(twoRootLayout.nodes.map((node) => node.id)).toEqual([
      "act_alpha_root",
      "act_beta_root",
    ]);
  });

  it("preserves designed probabilities and computes deterministic variants and happy path", () => {
    const graph = buildAggregateGraph({
      sessions,
      steps: [
        step("h1-1", "ses_h1", 1, "detect_incident"),
        step("h1-2", "ses_h1", 2, "triage_incident"),
        step("h1-3", "ses_h1", 3, "security_review"),
        step("h1-4", "ses_h1", 4, "deploy_fix"),
        step("h2-1", "ses_h2", 1, "detect_incident"),
        step("h2-2", "ses_h2", 2, "triage_incident"),
        step("h2-3", "ses_h2", 3, "deploy_fix"),
      ],
      workflows: [heliosWorkflow],
    });

    expect(
      graph.edges.find(
        (edge) =>
          edge.source === "act_triage_incident" &&
          edge.target === "act_security_review"
      )
    ).toMatchObject({ designedProbability: 0.85, plane: "both" });
    expect(graph.variants.map((variant) => variant.count)).toEqual([1, 1]);
    expect(graph.happyPath.map((pathStep) => pathStep.slug)).toEqual([
      "detect_incident",
      "triage_incident",
      "security_review",
      "deploy_fix",
    ]);
  });

  it("rebuilds five sessions and two thousand steps under the pure 50ms target", () => {
    const largeSessions = Array.from({ length: 5 }, (_, index) => ({
      id: `ses_perf_${index}`,
      projectId: "proj_helios",
      workflowId: "wf_helios",
    }));
    const slugs = [
      "detect_incident",
      "triage_incident",
      "security_review",
      "deploy_fix",
    ];
    const steps = Array.from({ length: 2000 }, (_, index) => {
      const session = largeSessions[index % largeSessions.length];
      expect(session).toBeDefined();
      return step(
        `perf-${index}`,
        session?.id ?? "missing",
        Math.floor(index / largeSessions.length),
        slugs[index % slugs.length] ?? "detect_incident"
      );
    });

    const input = {
      scope: { projectId: "proj_helios" },
      sessions: largeSessions,
      steps,
      workflows: [heliosWorkflow],
    };
    buildAggregateGraph(input);
    const samples: number[] = [];
    let graph = buildAggregateGraph(input);
    for (let index = 0; index < 5; index += 1) {
      const started = performance.now();
      graph = buildAggregateGraph(input);
      samples.push(performance.now() - started);
    }
    const elapsed = Math.min(...samples);

    expect(graph.stats.acceptedSteps).toBe(2000);
    expect(elapsed).toBeLessThan(50);
  });
});
