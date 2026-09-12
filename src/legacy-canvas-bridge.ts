import type {
  ActivityId,
  WorkflowId as ContractWorkflowId,
  GraphEdge,
  GraphEdgeId,
  GraphNode,
  GraphPlane,
  GraphView,
  ProcessSessionId,
  ProjectId,
  RoleId,
} from "../shared/contracts.ts";
import type { ProcessModel, WorkflowId } from "../shared/process.ts";
import type { AppSelection } from "./store.ts";

export interface LegacySelection {
  id: string;
  kind: "edge" | "node";
}

const roleMap: Record<string, RoleId> = {
  Compliance: "pmo",
  Engineering: "eng",
  Finance: "cpo",
  IT: "eng",
  Legal: "pmo",
  Manager: "pm",
  Operations: "support",
  Procurement: "pm",
  Support: "support",
};

export function legacyProcessToGraphView(
  model: ProcessModel,
  workflow: WorkflowId,
  generatedAt: string
): GraphView {
  const designedEdges = model.designedEdges ?? [];
  const designedSlugs = new Set(
    designedEdges.flatMap((edge) => [edge.source, edge.target])
  );
  const designedEdgeIds = new Set(designedEdges.map((edge) => edge.id));
  const nodesBySlug = new Map(model.nodes.map((node) => [node.id, node]));
  const slugs = new Set([...nodesBySlug.keys(), ...designedSlugs]);
  const nodes: GraphNode[] = [...slugs].map((slug) => {
    const node = nodesBySlug.get(slug);
    const support = node?.count ?? 0;
    const role = roleMap[node?.role ?? ""] ?? null;
    return {
      activity: {
        authored_synonyms: [],
        description: node?.label ?? slug,
        first_seen_ts: support > 0 ? generatedAt : undefined,
        id: activityId(slug),
        label: node?.label ?? humanizeSlug(slug),
        occurrences: support,
        plane: graphPlane(support, designedSlugs.has(slug)),
        policy_ids: [],
        project_id: projectId(workflow),
        role_expected: role,
        roles_observed: role && support > 0 ? [role] : [],
        slug,
        support,
      },
      id: activityId(slug),
      role_deviations: [],
      unreconciled: [],
    };
  });
  const observedEdges: GraphEdge[] = model.edges.map((edge) => ({
    cases: edge.evidence.map((item) => sessionId(item.caseId)),
    from: activityId(edge.source),
    id: graphEdgeId(edge.id),
    is_back_edge: edge.isBackEdge ?? false,
    kind: edge.isBackEdge ? "rework" : "sequence",
    observed_support: edge.count,
    plane: designedEdgeIds.has(edge.id) ? "both" : "discovered",
    probability: edge.probability,
    to: activityId(edge.target),
    violates: [],
    weight: edge.count,
  }));
  const observedEdgeIds = new Set(observedEdges.map((edge) => edge.id));
  const ghostEdges: GraphEdge[] = designedEdges
    .filter((edge) => !observedEdgeIds.has(graphEdgeId(edge.id)))
    .map((edge) => ({
      cases: [],
      from: activityId(edge.source),
      id: graphEdgeId(edge.id),
      is_back_edge: false,
      kind: "sequence",
      observed_support: 0,
      plane: "designed",
      probability: edge.probability,
      to: activityId(edge.target),
      violates: [],
      weight: edge.probability,
    }));
  return {
    conformance: null,
    edges: [...observedEdges, ...ghostEdges],
    generated_at: generatedAt,
    happy_path: observedEdges
      .filter((edge) => edge.probability === 1)
      .map((edge) => edge.id),
    key: `legacy:${workflow}`,
    kind: "overlay",
    min_support: 1,
    nodes,
    project_id: projectId(workflow),
    revision: model.stats.events,
    workflow_id: contractWorkflowId(workflow),
  };
}

export function canvasSelectionFromLegacy(
  selection: LegacySelection | undefined
): AppSelection | undefined {
  if (!selection) {
    return undefined;
  }
  if (selection.kind === "edge") {
    return { edge_id: graphEdgeId(selection.id) };
  }
  return { node_id: activityId(selection.id) };
}

export function legacySelectionFromCanvas(
  selection: AppSelection
): LegacySelection | undefined {
  if (selection.edge_id) {
    return { id: legacyEdgeId(selection.edge_id), kind: "edge" };
  }
  if (selection.node_id) {
    return { id: legacyActivityId(selection.node_id), kind: "node" };
  }
  return undefined;
}

function activityId(slug: string): ActivityId {
  return `act_${slug}` as ActivityId;
}

function contractWorkflowId(workflow: WorkflowId): ContractWorkflowId {
  return `wf_${workflow}` as ContractWorkflowId;
}

function graphEdgeId(id: string): GraphEdgeId {
  return `ged_${id}` as GraphEdgeId;
}

function graphPlane(support: number, designed: boolean): GraphPlane {
  if (designed && support > 0) {
    return "both";
  }
  return designed ? "designed" : "discovered";
}

function humanizeSlug(slug: string) {
  return slug
    .split("_")
    .filter(Boolean)
    .map((part) => part.slice(0, 1).toUpperCase() + part.slice(1))
    .join(" ");
}

export function legacyActivityId(id: string) {
  return id.startsWith("act_") ? id.slice(4) : id;
}

export function legacyEdgeId(id: string) {
  return id.startsWith("ged_") ? id.slice(4) : id;
}

function projectId(workflow: WorkflowId): ProjectId {
  return `proj_${workflow}` as ProjectId;
}

function sessionId(caseId: string): ProcessSessionId {
  return `ses_${caseId}` as ProcessSessionId;
}
