import dagre from "@dagrejs/dagre";
import type {
  ActivityId,
  GraphEdge,
  GraphNode,
  GraphView,
  StepId,
} from "../../../shared/contracts.ts";
import type {
  CanvasEdgeData,
  CanvasNodeData,
  CanvasPositionCache,
  LayoutResult,
  VisibleCanvasGraph,
  WorkflowCanvasMode,
} from "./types.ts";

const NODE_WIDTH = 200;
const NODE_HEIGHT = 80;

export function filterCanvasGraph(
  graph: GraphView,
  mode: WorkflowCanvasMode,
  minSupport: number
): VisibleCanvasGraph {
  const support = Math.max(0, minSupport);
  const nodes = graph.nodes.filter((node) => nodeVisible(node, mode, support));
  const visibleNodeIds = new Set(nodes.map((node) => node.id));
  const edges = graph.edges.filter(
    (edge) =>
      visibleNodeIds.has(edge.from) &&
      visibleNodeIds.has(edge.to) &&
      edgeVisible(edge, mode, support)
  );
  return { edges, nodes };
}

export function layoutCanvasGraph(
  visible: VisibleCanvasGraph,
  previousPositions: CanvasPositionCache = {}
): LayoutResult {
  const dag = new dagre.graphlib.Graph();
  dag.setDefaultEdgeLabel(() => ({}));
  dag.setGraph({
    marginx: 32,
    marginy: 28,
    nodesep: 40,
    rankdir: "LR",
    ranksep: 90,
  });
  for (const node of visible.nodes) {
    dag.setNode(node.id, { height: NODE_HEIGHT, width: NODE_WIDTH });
  }
  for (const edge of visible.edges) {
    if (!edge.is_back_edge) {
      dag.setEdge(edge.from, edge.to);
    }
  }
  dagre.layout(dag);
  const positionCache: CanvasPositionCache = {};
  const nodes = visible.nodes.map((node) => {
    const existing = previousPositions[node.id];
    const laidOut = dag.node(node.id);
    const position =
      existing ??
      (laidOut
        ? {
            x: laidOut.x - NODE_WIDTH / 2,
            y: laidOut.y - NODE_HEIGHT / 2,
          }
        : { x: 0, y: 0 });
    positionCache[node.id] = position;
    return {
      data: toCanvasNodeData(node, visible.edges),
      id: node.id,
      position,
    };
  });
  return {
    edges: visible.edges.map((edge) => ({
      data: toCanvasEdgeData(edge),
      id: edge.id,
      source: edge.from,
      target: edge.to,
    })),
    nodes,
    positionCache,
  };
}

export function selectionForNode(
  graph: GraphView,
  nodeId: ActivityId | StepId
) {
  return {
    node_id: nodeId,
    workflow_id: graph.workflow_id,
  };
}

export function selectionForEdge(graph: GraphView, edge: GraphEdge) {
  return {
    edge_id: edge.id,
    workflow_id: graph.workflow_id,
  };
}

export function supportLimit(graph: GraphView): number {
  return Math.max(
    1,
    ...graph.nodes.map((node) => node.activity.support),
    ...graph.edges.map((edge) => edge.observed_support)
  );
}

function nodeVisible(
  node: GraphNode,
  mode: WorkflowCanvasMode,
  minSupport: number
) {
  switch (mode) {
    case "designed":
      return node.activity.plane !== "discovered";
    case "discovered":
      return (
        node.activity.plane !== "designed" &&
        node.activity.support >= minSupport
      );
    case "instance":
      return true;
    case "overlay":
      return (
        node.activity.plane !== "discovered" ||
        node.activity.support >= minSupport
      );
    default:
      return assertNever(mode);
  }
}

function edgeVisible(
  edge: GraphEdge,
  mode: WorkflowCanvasMode,
  minSupport: number
) {
  switch (mode) {
    case "designed":
      return edge.plane !== "discovered";
    case "discovered":
      return edge.plane !== "designed" && edge.observed_support >= minSupport;
    case "instance":
      return true;
    case "overlay":
      return edge.plane !== "discovered" || edge.observed_support >= minSupport;
    default:
      return assertNever(mode);
  }
}

function toCanvasNodeData(
  node: GraphNode,
  edges: readonly GraphEdge[]
): CanvasNodeData {
  const relevantViolations = edges.filter(
    (edge) =>
      edge.violates.length > 0 && (edge.from === node.id || edge.to === node.id)
  );
  const groundedCount = Math.min(
    node.activity.occurrences,
    Math.max(0, node.activity.occurrences - node.unreconciled.length)
  );
  const groundingRatio =
    node.activity.occurrences === 0
      ? 0
      : groundedCount / node.activity.occurrences;
  return {
    groundedCount,
    groundingRatio,
    hasRoleDeviation: node.role_deviations.length > 0,
    hasUnreconciledWork: node.unreconciled.length > 0,
    id: node.id,
    isProposed:
      node.activity.support === 0 &&
      node.activity.plane === "discovered" &&
      node.activity.occurrences === 0,
    label: node.activity.label,
    plane: node.activity.plane,
    role: node.activity.role_expected ?? "unknown",
    support: node.activity.support,
    violationCount: relevantViolations.length,
  };
}

function toCanvasEdgeData(edge: GraphEdge): CanvasEdgeData {
  const support = edge.observed_support || edge.weight;
  const probability =
    edge.probability === null
      ? ""
      : ` · ${Math.round(edge.probability * 100)}%`;
  const violationText =
    edge.violates.length > 0 ? ` · violates ${edge.violates.join(", ")}` : "";
  return {
    cases: edge.cases,
    isBackEdge: edge.is_back_edge,
    kind: edge.kind,
    label: `${support} case${support === 1 ? "" : "s"}${probability}`,
    plane: edge.plane,
    support,
    tooltip: `${support} support · ${edge.kind}${violationText}`,
    violationCount: edge.violates.length,
  };
}

function assertNever(value: never): never {
  throw new Error(`Unhandled canvas mode ${value}`);
}
