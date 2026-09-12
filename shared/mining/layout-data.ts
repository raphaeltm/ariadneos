import type { AggregateEdge, AggregateGraph, AggregateNode } from "./graph.ts";

export interface LayoutNode {
  height: number;
  id: string;
  label: string;
  occurrences: number;
  order: number;
  plane: AggregateNode["plane"];
  rank: number;
  reworkRate: number;
  support: number;
  width: number;
  x: number;
  y: number;
}

export interface LayoutEdge {
  id: string;
  kind: AggregateEdge["kind"];
  occurrences: number;
  plane: AggregateEdge["plane"];
  probability: number;
  source: string;
  support: number;
  target: string;
}

export interface LayoutData {
  backEdges: LayoutEdge[];
  edges: LayoutEdge[];
  nodes: LayoutNode[];
}

const NODE_WIDTH = 188;
const NODE_HEIGHT = 72;
const RANK_GAP = 260;
const ORDER_GAP = 118;

export function buildLayoutData(graph: AggregateGraph): LayoutData {
  const nodeOrder = deterministicTopologicalOrder(graph.nodes, graph.edges);
  const orderIndex = new Map(nodeOrder.map((id, index) => [id, index]));
  const dagEdges = graph.edges
    .filter((edge) => edge.kind !== "rework" && !edge.isBackEdge)
    .filter(
      (edge) =>
        (orderIndex.get(edge.source) ?? 0) < (orderIndex.get(edge.target) ?? 0)
    )
    .sort(compareLayoutEdges);
  const ranks = computeRanks(nodeOrder, dagEdges);
  const rankCounts = new Map<number, number>();
  const nodes = nodeOrder
    .map((id) => graph.nodes.find((node) => node.id === id))
    .filter((node): node is AggregateNode => node !== undefined)
    .map((node, order) => {
      const rank = ranks.get(node.id) ?? 0;
      const rankOrder = rankCounts.get(rank) ?? 0;
      rankCounts.set(rank, rankOrder + 1);
      return {
        height: NODE_HEIGHT,
        id: node.id,
        label: node.label,
        occurrences: node.occurrences,
        order,
        plane: node.plane,
        rank,
        reworkRate: node.reworkRate,
        support: node.support,
        width: NODE_WIDTH,
        x: rank * RANK_GAP,
        y: rankOrder * ORDER_GAP,
      };
    });

  return {
    backEdges: graph.edges
      .filter((edge) => edge.kind === "rework" || edge.isBackEdge)
      .map(toLayoutEdge)
      .sort(compareLayoutEdges),
    edges: dagEdges.map(toLayoutEdge),
    nodes,
  };
}

export function layoutIsAcyclic(layout: LayoutData): boolean {
  const bySource = new Map<string, LayoutEdge[]>();
  for (const edge of layout.edges) {
    bySource.set(edge.source, [...(bySource.get(edge.source) ?? []), edge]);
  }
  const visiting = new Set<string>();
  const visited = new Set<string>();

  const visit = (nodeId: string): boolean => {
    if (visiting.has(nodeId)) {
      return false;
    }
    if (visited.has(nodeId)) {
      return true;
    }
    visiting.add(nodeId);
    for (const edge of bySource.get(nodeId) ?? []) {
      if (!visit(edge.target)) {
        return false;
      }
    }
    visiting.delete(nodeId);
    visited.add(nodeId);
    return true;
  };

  return layout.nodes.every((node) => visit(node.id));
}

function deterministicTopologicalOrder(
  nodes: AggregateNode[],
  edges: AggregateEdge[]
): string[] {
  const nodeIds = nodes
    .map((node) => node.id)
    .sort((a, b) => {
      const nodeA = nodes.find((node) => node.id === a);
      const nodeB = nodes.find((node) => node.id === b);
      return (
        (nodeA?.designedRank ?? Number.MAX_SAFE_INTEGER) -
          (nodeB?.designedRank ?? Number.MAX_SAFE_INTEGER) ||
        (nodeA?.slug ?? a).localeCompare(nodeB?.slug ?? b) ||
        a.localeCompare(b)
      );
    });
  const usableEdges = edges
    .filter((edge) => edge.kind !== "rework" && !edge.isBackEdge)
    .sort(compareLayoutEdges);
  const indegree = new Map(nodeIds.map((id) => [id, 0]));
  const outgoing = new Map<string, AggregateEdge[]>();
  for (const edge of usableEdges) {
    indegree.set(edge.target, (indegree.get(edge.target) ?? 0) + 1);
    outgoing.set(edge.source, [...(outgoing.get(edge.source) ?? []), edge]);
  }
  const available = nodeIds.filter((id) => (indegree.get(id) ?? 0) === 0);
  const ordered: string[] = [];
  while (available.length > 0) {
    available.sort((a, b) => nodeIds.indexOf(a) - nodeIds.indexOf(b));
    const next = available.shift();
    if (!next) {
      break;
    }
    ordered.push(next);
    for (const edge of outgoing.get(next) ?? []) {
      const nextIndegree = (indegree.get(edge.target) ?? 0) - 1;
      indegree.set(edge.target, nextIndegree);
      if (nextIndegree === 0) {
        available.push(edge.target);
      }
    }
  }
  return [...ordered, ...nodeIds.filter((id) => !ordered.includes(id))];
}

function computeRanks(
  nodeOrder: string[],
  edges: AggregateEdge[]
): Map<string, number> {
  const ranks = new Map(nodeOrder.map((id) => [id, 0]));
  const outgoing = new Map<string, AggregateEdge[]>();
  for (const edge of edges) {
    outgoing.set(edge.source, [...(outgoing.get(edge.source) ?? []), edge]);
  }
  for (const nodeId of nodeOrder) {
    const sourceRank = ranks.get(nodeId) ?? 0;
    for (const edge of outgoing.get(nodeId) ?? []) {
      ranks.set(
        edge.target,
        Math.max(ranks.get(edge.target) ?? 0, sourceRank + 1)
      );
    }
  }
  return ranks;
}

function toLayoutEdge(edge: AggregateEdge): LayoutEdge {
  return {
    id: edge.id,
    kind: edge.kind,
    occurrences: edge.occurrences,
    plane: edge.plane,
    probability: edge.probability,
    source: edge.source,
    support: edge.support,
    target: edge.target,
  };
}

function compareLayoutEdges(
  a: Pick<LayoutEdge, "id">,
  b: Pick<LayoutEdge, "id">
) {
  return a.id.localeCompare(b.id);
}
