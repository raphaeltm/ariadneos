import { describe, expect, it } from "vitest";
import type { GraphView } from "../shared/contracts.ts";
import {
  canvasKeyboardTargets,
  conformanceOverlaySummary,
  filterCanvasGraph,
  layoutCanvasGraph,
  nextCanvasKeyboardTarget,
  selectionForConformanceIssue,
  selectionForEdge,
  selectionForNode,
  shortcutActionForCanvas,
  supportLimit,
} from "../src/components/process-canvas/graph.ts";
import {
  buildObservedGraph,
  TEST_ACTIVITIES,
  TEST_WORKFLOW,
} from "./helpers/tenant.ts";

// Three observed cases over the authored workflow
// detect -> triage -> security_review -> deploy -> notify:
//
//  - every case skips security_review, so it is a missing designed activity;
//  - two cases add an undocumented escalate_to_ceo step;
//  - one case has deploy_fix performed by support rather than engineering,
//    which is a role deviation;
//  - one case reworks deploy_fix, producing a back edge.
//
// The graph is produced by the real mining and conformance code, so these tests
// assert on what the pipeline actually emits.
const securityReviewPolicy = {
  activity_slug: "security_review",
  id: "pol_security_review",
  kind: "mandatory" as const,
  params: {},
  project_id: "proj_checkout",
  text: "Every production deploy requires a passing security review.",
};

function observedGraph(minSupport = 1): GraphView {
  return buildObservedGraph({
    minSupport,
    policies: [securityReviewPolicy],
    roleOverrides: { U0SUPPORT: "support" },
    steps: [
      // Case one: skips the review and escalates.
      {
        activitySlug: "detect_incident",
        actor: "U0OPS",
        seq: 1,
        sessionId: "ses_one",
        ts: "1700000001.000100",
      },
      {
        activitySlug: "triage_incident",
        actor: "U0OPS",
        seq: 2,
        sessionId: "ses_one",
        ts: "1700000002.000100",
      },
      {
        activitySlug: "escalate_to_ceo",
        actor: "U0OPS",
        seq: 3,
        sessionId: "ses_one",
        ts: "1700000003.000100",
        type: "decision",
      },
      {
        activitySlug: "deploy_fix",
        actor: "U0ENG",
        seq: 4,
        sessionId: "ses_one",
        ts: "1700000004.000100",
      },
      {
        activitySlug: "notify_customer",
        actor: "U0OPS",
        seq: 5,
        sessionId: "ses_one",
        ts: "1700000005.000100",
      },
      // Case two: escalates and reworks the deploy.
      {
        activitySlug: "detect_incident",
        actor: "U0OPS",
        seq: 1,
        sessionId: "ses_two",
        ts: "1700000011.000100",
      },
      {
        activitySlug: "triage_incident",
        actor: "U0OPS",
        seq: 2,
        sessionId: "ses_two",
        ts: "1700000012.000100",
      },
      {
        activitySlug: "escalate_to_ceo",
        actor: "U0OPS",
        seq: 3,
        sessionId: "ses_two",
        ts: "1700000013.000100",
        type: "decision",
      },
      {
        activitySlug: "deploy_fix",
        actor: "U0ENG",
        seq: 4,
        sessionId: "ses_two",
        ts: "1700000014.000100",
      },
      {
        activitySlug: "triage_incident",
        actor: "U0OPS",
        seq: 5,
        sessionId: "ses_two",
        ts: "1700000015.000100",
        type: "rework",
      },
      {
        activitySlug: "deploy_fix",
        actor: "U0ENG",
        seq: 6,
        sessionId: "ses_two",
        ts: "1700000016.000100",
      },
      {
        activitySlug: "notify_customer",
        actor: "U0OPS",
        seq: 7,
        sessionId: "ses_two",
        ts: "1700000017.000100",
      },
      // Case three: support performs the deploy, which its role does not cover.
      {
        activitySlug: "detect_incident",
        actor: "U0OPS",
        seq: 1,
        sessionId: "ses_three",
        ts: "1700000021.000100",
      },
      {
        activitySlug: "triage_incident",
        actor: "U0OPS",
        seq: 2,
        sessionId: "ses_three",
        ts: "1700000022.000100",
      },
      {
        activitySlug: "deploy_fix",
        actor: "U0SUPPORT",
        seq: 3,
        sessionId: "ses_three",
        ts: "1700000023.000100",
      },
      {
        activitySlug: "notify_customer",
        actor: "U0OPS",
        seq: 4,
        sessionId: "ses_three",
        ts: "1700000024.000100",
      },
    ],
  });
}

function positionMap(layout: ReturnType<typeof layoutCanvasGraph>) {
  return Object.fromEntries(
    layout.nodes.map((node) => [node.id, node.position])
  ) satisfies Record<string, { x: number; y: number }>;
}

describe("workflow process canvas", () => {
  it("keeps designed activities visible in overlay even with no observations", () => {
    const graph = observedGraph();
    const visible = filterCanvasGraph(graph, "overlay", 3);
    const ids = new Set(visible.nodes.map((node) => node.id));
    // security_review was never observed but is designed, so it stays as a ghost.
    expect(ids.has("act_security_review")).toBe(true);
    expect(visible.edges.every((edge) => ids.has(edge.from))).toBe(true);
    expect(visible.edges.every((edge) => ids.has(edge.to))).toBe(true);
  });

  it("drops discovered work below the support threshold", () => {
    const graph = observedGraph();
    const lenient = filterCanvasGraph(graph, "overlay", 1);
    const strict = filterCanvasGraph(graph, "overlay", 3);
    expect(
      lenient.nodes.some((node) => node.id === "act_escalate_to_ceo")
    ).toBe(true);
    // escalate_to_ceo appears in two of three cases, so support 3 excludes it.
    expect(strict.nodes.some((node) => node.id === "act_escalate_to_ceo")).toBe(
      false
    );
  });

  it("shows only observed supported topology in discovered mode", () => {
    const graph = observedGraph();
    const visible = filterCanvasGraph(graph, "discovered", 2);
    expect(
      visible.nodes.some((node) => node.activity.plane === "designed")
    ).toBe(false);
    expect(visible.edges.some((edge) => edge.observed_support < 2)).toBe(false);
    const ids = new Set(visible.nodes.map((node) => node.id));
    expect(visible.edges.every((edge) => ids.has(edge.from))).toBe(true);
    expect(visible.edges.every((edge) => ids.has(edge.to))).toBe(true);
  });

  it("excludes back-edges from dagre layout but keeps them renderable", () => {
    const graph = observedGraph();
    const withBackEdge = filterCanvasGraph(graph, "overlay", 1);
    const backEdge = withBackEdge.edges.find((edge) => edge.is_back_edge);
    expect(backEdge).toBeDefined();
    const withoutBackEdge = {
      edges: withBackEdge.edges.filter((edge) => edge.id !== backEdge?.id),
      nodes: withBackEdge.nodes,
    };
    const layoutWith = layoutCanvasGraph(withBackEdge, graph);
    const layoutWithout = layoutCanvasGraph(withoutBackEdge, graph);
    expect(layoutWith.edges.map((edge) => edge.id)).toContain(backEdge?.id);
    expect(positionMap(layoutWith)).toEqual(positionMap(layoutWithout));
  });

  it("keeps existing node positions stable when a new node arrives", () => {
    const graph = observedGraph();
    const initial = filterCanvasGraph(graph, "overlay", 3);
    const initialLayout = layoutCanvasGraph(initial, graph);
    const expanded = filterCanvasGraph(graph, "overlay", 1);
    const expandedLayout = layoutCanvasGraph(
      expanded,
      graph,
      initialLayout.positionCache
    );
    for (const node of initialLayout.nodes) {
      expect(expandedLayout.positionCache[node.id]).toEqual(node.position);
    }
  });

  it("emits client-state selection payloads", () => {
    const graph = observedGraph();
    const [edge] = graph.edges;
    expect(selectionForNode(graph, "act_deploy_fix")).toEqual({
      node_id: "act_deploy_fix",
      workflow_id: TEST_WORKFLOW,
    });
    if (!edge) {
      throw new Error("Expected the observed graph to contain an edge.");
    }
    expect(selectionForEdge(graph, edge)).toEqual({
      edge_id: edge.id,
      workflow_id: TEST_WORKFLOW,
    });
  });

  it("derives support control bounds from graph nodes and edges", () => {
    const graph = observedGraph();
    // Three cases observe detect_incident, so the slider tops out at 3.
    expect(supportLimit(graph)).toBe(3);
    expect(supportLimit({ ...graph, edges: [], nodes: [] })).toBe(1);
  });

  it("summarizes conformance overlay issues from the graph score", () => {
    const summary = conformanceOverlaySummary(observedGraph());
    expect(summary.missingCount).toBeGreaterThan(0);
    expect(summary.extraCount).toBeGreaterThan(0);
    expect(summary).toMatchObject({
      orderBreakCount: expect.any(Number),
      roleDeviationCount: expect.any(Number),
      violationCount: expect.any(Number),
    });
  });

  it("annotates a designed activity nobody performed as missing", () => {
    const graph = observedGraph();
    const visible = filterCanvasGraph(graph, "overlay", 1);
    const layout = layoutCanvasGraph(visible, graph);
    const byId = new Map(layout.nodes.map((node) => [node.id, node.data]));
    expect(byId.get("act_security_review")).toMatchObject({
      diffKind: "missing",
      severity: "warning",
    });
  });

  it("annotates observed work outside the designed workflow as extra", () => {
    const graph = observedGraph();
    const visible = filterCanvasGraph(graph, "overlay", 1);
    const layout = layoutCanvasGraph(visible, graph);
    const byId = new Map(layout.nodes.map((node) => [node.id, node.data]));
    expect(byId.get("act_escalate_to_ceo")).toMatchObject({
      diffKind: "extra",
      severity: "info",
    });
  });

  it("selects a representative node for each conformance issue kind", () => {
    const graph = observedGraph();
    expect(selectionForConformanceIssue(graph, "missing")).toEqual({
      node_id: "act_security_review",
      workflow_id: TEST_WORKFLOW,
    });
    expect(selectionForConformanceIssue(graph, "extra")).toEqual({
      node_id: "act_escalate_to_ceo",
      workflow_id: TEST_WORKFLOW,
    });
  });

  it("orders keyboard targets across visible nodes and edges", () => {
    const graph = observedGraph();
    const visible = filterCanvasGraph(graph, "overlay", 2);
    const targets = canvasKeyboardTargets(visible, graph);
    expect(targets[0]).toMatchObject({
      id: visible.nodes[0]?.id,
      kind: "node",
    });
    expect(targets.some((target) => target.kind === "edge")).toBe(true);
    expect(nextCanvasKeyboardTarget(targets, undefined, 1)).toBe(targets[0]);
    expect(nextCanvasKeyboardTarget(targets, targets[0]?.id, 1)).toBe(
      targets[1]
    );
    expect(nextCanvasKeyboardTarget(targets, targets[0]?.id, -1)).toBe(
      targets.at(-1)
    );
  });

  it("covers every authored activity in the designed plane", () => {
    const graph = observedGraph();
    const designedSlugs = new Set(
      graph.nodes
        .filter(
          (node) =>
            node.activity.plane === "designed" || node.activity.plane === "both"
        )
        .map((node) => node.activity.slug)
    );
    for (const activity of TEST_ACTIVITIES) {
      expect(designedSlugs.has(activity.slug)).toBe(true);
    }
  });

  it("maps canvas keyboard shortcuts without stealing text input", () => {
    expect(shortcutActionForCanvas({ key: "ArrowRight" })).toBe("select_next");
    expect(shortcutActionForCanvas({ key: "ArrowLeft" })).toBe(
      "select_previous"
    );
    expect(shortcutActionForCanvas({ key: "ArrowDown", shiftKey: true })).toBe(
      "pan_down"
    );
    expect(shortcutActionForCanvas({ key: "=", metaKey: true })).toBe(
      "zoom_in"
    );
    expect(shortcutActionForCanvas({ ctrlKey: true, key: "-" })).toBe(
      "zoom_out"
    );
    expect(shortcutActionForCanvas({ key: "0" })).toBe("fit_view");
    expect(shortcutActionForCanvas({ key: "Delete" })).toBe("clear_selection");
    expect(shortcutActionForCanvas({ ctrlKey: true, key: "z" })).toBe(
      "restore_selection"
    );
    expect(
      shortcutActionForCanvas({
        key: "ArrowRight",
        targetTagName: "input",
      })
    ).toBeNull();
    expect(
      shortcutActionForCanvas({
        key: "z",
        metaKey: true,
        targetIsContentEditable: true,
      })
    ).toBeNull();
  });
});
