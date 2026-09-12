import { describe, expect, it } from "vitest";
import { overlayGraph } from "../shared/fixtures.ts";
import {
  filterCanvasGraph,
  layoutCanvasGraph,
  selectionForEdge,
  selectionForNode,
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
    const layoutWithout = layoutCanvasGraph(withoutBackEdge);
    const layoutWith = layoutCanvasGraph(withBackEdge);
    expect(layoutWith.edges.map((edge) => edge.id)).toContain(
      "ged_deploy_root_rework"
    );
    expect(positionMap(layoutWith)).toEqual(positionMap(layoutWithout));
  });

  it("keeps existing node positions stable when a new node arrives", () => {
    const initial = filterCanvasGraph(overlayGraph, "overlay", 2);
    const initialLayout = layoutCanvasGraph(initial);
    const expanded = filterCanvasGraph(overlayGraph, "overlay", 1);
    const expandedLayout = layoutCanvasGraph(
      expanded,
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
});

function positionMap(layout: ReturnType<typeof layoutCanvasGraph>) {
  return Object.fromEntries(
    layout.nodes.map((node) => [node.id, node.position])
  ) satisfies Record<string, { x: number; y: number }>;
}
