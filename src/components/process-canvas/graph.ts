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
  CanvasEdgeDiffKind,
  CanvasNodeData,
  CanvasNodeDiffKind,
  CanvasPositionCache,
  CanvasSeverity,
  ConformanceIssueKind,
  ConformanceOverlaySummary,
  LayoutResult,
  VisibleCanvasGraph,
  WorkflowCanvasMode,
} from "./types.ts";

const NODE_WIDTH = 200;
const NODE_HEIGHT = 80;
const TEXT_ENTRY_TAGS = new Set(["INPUT", "SELECT", "TEXTAREA"]);
const BASE_SHORTCUTS = new Map<string, CanvasKeyboardAction>([
  ["arrowdown", "select_next"],
  ["arrowleft", "select_previous"],
  ["arrowright", "select_next"],
  ["arrowup", "select_previous"],
  ["backspace", "clear_selection"],
  ["delete", "clear_selection"],
  ["end", "select_last"],
  ["escape", "clear_selection"],
  ["home", "select_first"],
  ["0", "fit_view"],
  ["+", "zoom_in"],
  ["=", "zoom_in"],
  ["-", "zoom_out"],
  ["_", "zoom_out"],
]);
const COMMAND_SHORTCUTS = new Map<string, CanvasKeyboardAction>([
  ["0", "fit_view"],
  ["+", "zoom_in"],
  ["=", "zoom_in"],
  ["-", "zoom_out"],
  ["_", "zoom_out"],
  ["z", "restore_selection"],
]);
const PAN_SHORTCUTS = new Map<string, CanvasKeyboardAction>([
  ["arrowdown", "pan_down"],
  ["arrowleft", "pan_left"],
  ["arrowright", "pan_right"],
  ["arrowup", "pan_up"],
]);

export const canvasShortcutInstructions =
  "Use arrow keys to select graph items, Shift plus arrow keys to pan, plus and minus to zoom, 0 to fit the graph, Delete to clear the current selection, and Control or Command Z to restore the previous selection.";

export type CanvasKeyboardAction =
  | "clear_selection"
  | "fit_view"
  | "pan_down"
  | "pan_left"
  | "pan_right"
  | "pan_up"
  | "restore_selection"
  | "select_first"
  | "select_last"
  | "select_next"
  | "select_previous"
  | "zoom_in"
  | "zoom_out";

export type CanvasKeyboardTarget =
  | {
      id: ActivityId | StepId;
      kind: "node";
      label: string;
    }
  | {
      id: GraphEdge["id"];
      kind: "edge";
      label: string;
    };

export interface CanvasShortcutInput {
  altKey?: boolean;
  ctrlKey?: boolean;
  key: string;
  metaKey?: boolean;
  shiftKey?: boolean;
  targetIsContentEditable?: boolean;
  targetRole?: string | null;
  targetTagName?: string;
}

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
  graph: GraphView,
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
      data: toCanvasNodeData(node, visible.edges, graph),
      id: node.id,
      position,
    };
  });
  return {
    edges: visible.edges.map((edge) => ({
      data: toCanvasEdgeData(edge, graph),
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

export function conformanceOverlaySummary(
  graph: GraphView
): ConformanceOverlaySummary {
  return {
    extraCount: graph.conformance?.extra.length ?? 0,
    missingCount: graph.conformance?.missing.length ?? 0,
    orderBreakCount: graph.conformance?.order_breaks.length ?? 0,
    roleDeviationCount: graph.conformance?.role_deviations.length ?? 0,
    violationCount: graph.conformance?.violations.length ?? 0,
  };
}

export function selectionForConformanceIssue(
  graph: GraphView,
  kind: ConformanceIssueKind
) {
  const node = nodeForIssue(graph, kind);
  if (node) {
    return selectionForNode(graph, node.id);
  }
  const edge = edgeForIssue(graph, kind);
  return edge ? selectionForEdge(graph, edge) : null;
}

export function canvasKeyboardTargets(
  visible: VisibleCanvasGraph,
  graph: GraphView
): CanvasKeyboardTarget[] {
  return [
    ...visible.nodes.map((node) => ({
      id: node.id,
      kind: "node" as const,
      label: describeCanvasNode(node, visible.edges),
    })),
    ...visible.edges.map((edge) => ({
      id: edge.id,
      kind: "edge" as const,
      label: describeCanvasEdge(edge, graph),
    })),
  ];
}

export function nextCanvasKeyboardTarget(
  targets: readonly CanvasKeyboardTarget[],
  selectedId: string | undefined,
  direction: -1 | 1
): CanvasKeyboardTarget | undefined {
  if (targets.length === 0) {
    return undefined;
  }
  const currentIndex = targets.findIndex((target) => target.id === selectedId);
  if (currentIndex === -1) {
    return direction === 1 ? targets[0] : targets.at(-1);
  }
  const nextIndex =
    (currentIndex + direction + targets.length) % targets.length;
  return targets[nextIndex];
}

export function edgeForKeyboardTarget(
  graph: GraphView,
  target: CanvasKeyboardTarget
): GraphEdge | undefined {
  return target.kind === "edge"
    ? graph.edges.find((edge) => edge.id === target.id)
    : undefined;
}

export function shortcutActionForCanvas(
  input: CanvasShortcutInput
): CanvasKeyboardAction | null {
  if (isTextEntryShortcutTarget(input)) {
    return null;
  }
  const key = input.key.toLowerCase();
  const command = Boolean(input.ctrlKey || input.metaKey);
  if (input.altKey) {
    return null;
  }
  if (command) {
    return input.shiftKey ? null : (COMMAND_SHORTCUTS.get(key) ?? null);
  }
  return input.shiftKey
    ? (PAN_SHORTCUTS.get(key) ?? null)
    : (BASE_SHORTCUTS.get(key) ?? null);
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
  edges: readonly GraphEdge[],
  graph: GraphView
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
  const annotation = nodeAnnotation(node, relevantViolations, graph);
  return {
    annotationLabel: annotation.label,
    annotationTitle: annotation.title,
    ariaLabel: describeCanvasNode(node, edges),
    diffKind: annotation.diffKind,
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
    severity: annotation.severity,
    support: node.activity.support,
    violationCount: relevantViolations.length,
  };
}

function toCanvasEdgeData(edge: GraphEdge, graph: GraphView): CanvasEdgeData {
  const support = edge.observed_support || edge.weight;
  const probability =
    edge.probability === null
      ? ""
      : ` · ${Math.round(edge.probability * 100)}%`;
  const violationText =
    edge.violates.length > 0 ? ` · violates ${edge.violates.join(", ")}` : "";
  const annotation = edgeAnnotation(edge, graph);
  return {
    annotationLabel: annotation.label,
    annotationTitle: annotation.title,
    ariaLabel: describeCanvasEdge(edge, graph),
    cases: edge.cases,
    diffKind: annotation.diffKind,
    isBackEdge: edge.is_back_edge,
    kind: edge.kind,
    label: `${support} case${support === 1 ? "" : "s"}${probability}`,
    plane: edge.plane,
    severity: annotation.severity,
    support,
    tooltip: `${support} support · ${edge.kind}${violationText}`,
    violationCount: edge.violates.length,
  };
}

function edgeAnnotation(
  edge: GraphEdge,
  graph: GraphView
): {
  diffKind: CanvasEdgeDiffKind;
  label: string | null;
  severity: CanvasSeverity;
  title: string | null;
} {
  if (edge.violates.length > 0) {
    return {
      diffKind: "violation",
      label: "policy",
      severity: "critical",
      title: `Violates ${edge.violates.join(", ")}`,
    };
  }
  if (edgeMatchesOrderBreak(edge, graph)) {
    return {
      diffKind: "deviant-path",
      label: "deviant",
      severity: "warning",
      title: "Observed transition skips a designed ordering expectation.",
    };
  }
  if (edge.plane === "discovered") {
    return {
      diffKind: "extra-path",
      label: "extra",
      severity: "info",
      title: "Observed transition is not in the documented workflow.",
    };
  }
  if (edge.plane === "designed") {
    return {
      diffKind: "missing-path",
      label: "missing",
      severity: "warning",
      title: "Documented transition has not been observed.",
    };
  }
  return {
    diffKind: "conformant",
    label: null,
    severity: "none",
    title: null,
  };
}

function edgeForIssue(
  graph: GraphView,
  kind: ConformanceIssueKind
): GraphEdge | null {
  if (kind === "violation") {
    return graph.edges.find((edge) => edge.violates.length > 0) ?? null;
  }
  if (kind === "missing") {
    return graph.edges.find((edge) => edge.plane === "designed") ?? null;
  }
  if (kind === "extra") {
    return graph.edges.find((edge) => edge.plane === "discovered") ?? null;
  }
  return null;
}

function edgeMatchesOrderBreak(edge: GraphEdge, graph: GraphView): boolean {
  const from = activitySlugForId(graph, edge.from);
  const to = activitySlugForId(graph, edge.to);
  if (!(from && to)) {
    return false;
  }
  return (
    graph.conformance?.order_breaks.some(
      (orderBreak) => orderBreak.from === from && orderBreak.to === to
    ) ?? false
  );
}

function nodeAnnotation(
  node: GraphNode,
  relevantViolations: readonly GraphEdge[],
  graph: GraphView
): {
  diffKind: CanvasNodeDiffKind;
  label: string | null;
  severity: CanvasSeverity;
  title: string | null;
} {
  if (relevantViolations.length > 0) {
    return {
      diffKind: "violation",
      label: "policy",
      severity: "critical",
      title: "A policy violation touches this activity.",
    };
  }
  if (node.role_deviations.length > 0) {
    return {
      diffKind: "role-deviation",
      label: "role",
      severity: "warning",
      title: "Observed actor role differs from the documented role.",
    };
  }
  const missing = graph.conformance?.missing.find(
    (item) => item.slug === node.activity.slug
  );
  if (missing || node.activity.plane === "designed") {
    return {
      diffKind: "missing",
      label: missing
        ? `missing ${missing.of - missing.seen_in_sessions}`
        : "ghost",
      severity: "warning",
      title: missing
        ? `Documented activity missing in ${
            missing.of - missing.seen_in_sessions
          } of ${missing.of} closed sessions.`
        : "Documented activity has not been observed.",
    };
  }
  const extra = graph.conformance?.extra.find(
    (item) => item.slug === node.activity.slug
  );
  if (extra || node.activity.plane === "discovered") {
    return {
      diffKind: "extra",
      label: extra ? `extra x${extra.occurrences}` : "extra",
      severity: "info",
      title: "Observed activity is not in the documented workflow.",
    };
  }
  return {
    diffKind: "conformant",
    label: null,
    severity: "none",
    title: null,
  };
}

function nodeForIssue(
  graph: GraphView,
  kind: ConformanceIssueKind
): GraphNode | null {
  if (kind === "missing") {
    const slug = graph.conformance?.missing[0]?.slug;
    return (
      graph.nodes.find((node) => node.activity.slug === slug) ??
      graph.nodes.find((node) => node.activity.plane === "designed") ??
      null
    );
  }
  if (kind === "extra") {
    const slug = graph.conformance?.extra[0]?.slug;
    return (
      graph.nodes.find((node) => node.activity.slug === slug) ??
      graph.nodes.find((node) => node.activity.plane === "discovered") ??
      null
    );
  }
  if (kind === "role-deviation") {
    const activityId = graph.conformance?.role_deviations[0]?.activity_id;
    return (
      graph.nodes.find((node) => node.id === activityId) ??
      graph.nodes.find((node) => node.role_deviations.length > 0) ??
      null
    );
  }
  return null;
}

function activitySlugForId(
  graph: GraphView,
  id: GraphEdge["from"] | GraphEdge["to"]
): string | null {
  return graph.nodes.find((node) => node.id === id)?.activity.slug ?? null;
}

function describeCanvasNode(
  node: GraphNode,
  edges: readonly GraphEdge[]
): string {
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
      : Math.round((groundedCount / node.activity.occurrences) * 100);
  const details = [
    node.activity.label,
    `${planeLabel(node.activity.plane)} activity`,
    `${node.activity.role_expected ?? "unknown"} role`,
    `${node.activity.support} support`,
    `${groundingRatio}% grounded`,
  ];
  if (node.role_deviations.length > 0) {
    details.push(`${node.role_deviations.length} role deviations`);
  }
  if (node.unreconciled.length > 0) {
    details.push(`${node.unreconciled.length} unreconciled steps`);
  }
  if (relevantViolations.length > 0) {
    details.push(`${relevantViolations.length} policy violations`);
  }
  return details.join(", ");
}

function describeCanvasEdge(edge: GraphEdge, graph: GraphView): string {
  const from = activityLabelForId(graph, edge.from) ?? edge.from;
  const to = activityLabelForId(graph, edge.to) ?? edge.to;
  const support = edge.observed_support || edge.weight;
  const details = [
    `${from} to ${to}`,
    `${planeLabel(edge.plane)} ${edge.kind} transition`,
    `${support} support`,
  ];
  if (edge.probability !== null) {
    details.push(`${Math.round(edge.probability * 100)}% probability`);
  }
  if (edge.is_back_edge) {
    details.push("rework path");
  }
  if (edge.violates.length > 0) {
    details.push(`violates ${edge.violates.join(", ")}`);
  }
  return details.join(", ");
}

function activityLabelForId(
  graph: GraphView,
  id: GraphEdge["from"] | GraphEdge["to"]
): string | null {
  return graph.nodes.find((node) => node.id === id)?.activity.label ?? null;
}

function planeLabel(plane: GraphNode["activity"]["plane"]) {
  switch (plane) {
    case "both":
      return "documented and observed";
    case "designed":
      return "documented";
    case "discovered":
      return "discovered";
    default:
      return assertNever(plane);
  }
}

function isTextEntryShortcutTarget(input: CanvasShortcutInput): boolean {
  if (input.targetIsContentEditable) {
    return true;
  }
  if (input.targetRole === "textbox") {
    return true;
  }
  return input.targetTagName
    ? TEXT_ENTRY_TAGS.has(input.targetTagName.toUpperCase())
    : false;
}

function assertNever(value: never): never {
  throw new Error(`Unhandled canvas mode ${value}`);
}
