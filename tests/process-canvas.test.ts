import { describe, expect, it } from "vitest";
import { overlayGraph } from "../shared/fixtures.ts";
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

describe("workflow process canvas", () => {
  it("preserves designed ghosts in overlay while filtering low-support discovered work", () => {
    const visible = filterCanvasGraph(overlayGraph, "overlay", 2);
    const ids = new Set(visible.nodes.map((node) => node.id));
    expect(ids.has("act_write_postmortem")).toBe(true);
    expect(ids.has("act_security_review")).toBe(true);
    expect(ids.has("act_escalate_to_ceo")).toBe(false);
    expect(visible.edges.every((edge) => ids.has(edge.from))).toBe(true);
    expect(visible.edges.every((edge) => ids.has(edge.to))).toBe(true);
  });

  it("shows only observed supported topology in discovered mode", () => {
    const visible = filterCanvasGraph(overlayGraph, "discovered", 2);
    expect(
      visible.nodes.some((node) => node.activity.plane === "designed")
    ).toBe(false);
    expect(visible.edges.some((edge) => edge.observed_support < 2)).toBe(false);
    const ids = new Set(visible.nodes.map((node) => node.id));
    expect(visible.edges.every((edge) => ids.has(edge.from))).toBe(true);
    expect(visible.edges.every((edge) => ids.has(edge.to))).toBe(true);
  });

  it("excludes back-edges from dagre layout but keeps them renderable", () => {
    const withoutBackEdge = {
      edges: overlayGraph.edges.filter(
        (edge) => edge.id !== "ged_deploy_root_rework"
      ),
      nodes: overlayGraph.nodes,
    };
    const withBackEdge = filterCanvasGraph(overlayGraph, "overlay", 1);
    const layoutWithout = layoutCanvasGraph(withoutBackEdge, overlayGraph);
    const layoutWith = layoutCanvasGraph(withBackEdge, overlayGraph);
    expect(layoutWith.edges.map((edge) => edge.id)).toContain(
      "ged_deploy_root_rework"
    );
    expect(positionMap(layoutWith)).toEqual(positionMap(layoutWithout));
  });

  it("keeps existing node positions stable when a new node arrives", () => {
    const initial = filterCanvasGraph(overlayGraph, "overlay", 2);
    const initialLayout = layoutCanvasGraph(initial, overlayGraph);
    const expanded = filterCanvasGraph(overlayGraph, "overlay", 1);
    const expandedLayout = layoutCanvasGraph(
      expanded,
      overlayGraph,
      initialLayout.positionCache
    );
    for (const node of initialLayout.nodes) {
      expect(expandedLayout.positionCache[node.id]).toEqual(node.position);
    }
  });

  it("emits client-state selection payloads", () => {
    const [edge] = overlayGraph.edges;
    expect(selectionForNode(overlayGraph, "act_security_review")).toEqual({
      node_id: "act_security_review",
      workflow_id: "wf_p1_incident",
    });
    if (!edge) {
      throw new Error("Expected overlay graph edge fixture.");
    }
    expect(selectionForEdge(overlayGraph, edge)).toEqual({
      edge_id: edge.id,
      workflow_id: "wf_p1_incident",
    });
  });

  it("derives support control bounds from graph nodes and edges", () => {
    expect(supportLimit(overlayGraph)).toBe(3);
    expect(supportLimit({ ...overlayGraph, edges: [], nodes: [] })).toBe(1);
  });

  it("summarizes conformance overlay issues from the graph score", () => {
    expect(conformanceOverlaySummary(overlayGraph)).toEqual({
      extraCount: 3,
      missingCount: 2,
      orderBreakCount: 1,
      roleDeviationCount: 1,
      violationCount: 1,
    });
  });

  it("annotates visible nodes with diff kind and severity", () => {
    const visible = filterCanvasGraph(overlayGraph, "overlay", 1);
    const layout = layoutCanvasGraph(visible, overlayGraph);
    const byId = new Map(layout.nodes.map((node) => [node.id, node.data]));

    expect(byId.get("act_security_review")).toMatchObject({
      diffKind: "missing",
      severity: "warning",
    });
    expect(byId.get("act_escalate_to_ceo")).toMatchObject({
      diffKind: "extra",
      severity: "info",
    });
    expect(byId.get("act_assign_owner")).toMatchObject({
      diffKind: "role-deviation",
      severity: "warning",
    });
    expect(byId.get("act_deploy_fix")).toMatchObject({
      diffKind: "violation",
      severity: "critical",
    });
  });

  it("annotates deviant and violating edges", () => {
    const visible = filterCanvasGraph(overlayGraph, "overlay", 1);
    const layout = layoutCanvasGraph(visible, overlayGraph);
    const byId = new Map(layout.edges.map((edge) => [edge.id, edge.data]));

    expect(byId.get("ged_detect_escalate")).toMatchObject({
      diffKind: "extra-path",
      severity: "info",
    });
    expect(byId.get("ged_root_deploy_violation")).toMatchObject({
      diffKind: "violation",
      severity: "critical",
    });
  });

  it("selects representative conformance issues", () => {
    expect(selectionForConformanceIssue(overlayGraph, "missing")).toEqual({
      node_id: "act_security_review",
      workflow_id: "wf_p1_incident",
    });
    expect(selectionForConformanceIssue(overlayGraph, "extra")).toEqual({
      node_id: "act_escalate_to_ceo",
      workflow_id: "wf_p1_incident",
    });
    expect(
      selectionForConformanceIssue(overlayGraph, "role-deviation")
    ).toEqual({
      node_id: "act_assign_owner",
      workflow_id: "wf_p1_incident",
    });
    expect(selectionForConformanceIssue(overlayGraph, "violation")).toEqual({
      edge_id: "ged_root_deploy_violation",
      workflow_id: "wf_p1_incident",
    });
  });

  it("orders keyboard targets across visible nodes and edges", () => {
    const visible = filterCanvasGraph(overlayGraph, "overlay", 2);
    const targets = canvasKeyboardTargets(visible, overlayGraph);
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

function positionMap(layout: ReturnType<typeof layoutCanvasGraph>) {
  return Object.fromEntries(
    layout.nodes.map((node) => [node.id, node.position])
  ) satisfies Record<string, { x: number; y: number }>;
}
