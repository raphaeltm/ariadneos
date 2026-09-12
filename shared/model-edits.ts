import type {
  DesignedEdgeInput,
  DesignedWorkflowInput,
  MiningStepInput,
} from "./mining/graph.ts";

export type DesignedGraphEditAction =
  | "add_edge"
  | "add_node"
  | "merge_nodes"
  | "remove_edge"
  | "remove_node"
  | "rename_node";

export type DesignedGraphEditPayload = Record<
  string,
  boolean | number | string | string[] | undefined
>;

export interface DesignedGraphEdit {
  action: DesignedGraphEditAction;
  id: string;
  payload: DesignedGraphEditPayload;
  revision: number;
  undone?: boolean;
}

export interface EffectiveDesignedWorkflow {
  mergedSlugs: Record<string, string>;
  workflow: DesignedWorkflowInput;
}

interface EditableActivity {
  id: string;
  label: string;
  policyIds: string[];
  rank: number;
  roleExpected: string | null;
  slug: string;
}

interface EditableEdge {
  kind: DesignedEdgeInput["kind"];
  probability: number;
  source: string;
  target: string;
}

interface EditableWorkflow {
  activities: EditableActivity[];
  edges: EditableEdge[];
  entryActivitySlug?: string;
  exitActivitySlugs: string[];
  id: string;
  name?: string;
  projectId?: string | null;
}

const DEFAULT_EDGE_PROBABILITY = 1;

export function applyDesignedGraphEdits(
  base: DesignedWorkflowInput,
  edits: readonly DesignedGraphEdit[]
): EffectiveDesignedWorkflow {
  const editable = toEditableWorkflow(base);
  const mergedSlugs = new Map<string, string>();

  for (const edit of edits
    .filter((item) => !item.undone)
    .sort((a, b) => a.revision - b.revision || a.id.localeCompare(b.id))) {
    applyEdit(edit, editable, mergedSlugs);
  }

  return {
    mergedSlugs: Object.fromEntries(mergedSlugs),
    workflow: fromEditableWorkflow(editable),
  };
}

export function rewriteStepForDesignedEdits(
  step: MiningStepInput,
  mergedSlugs: Record<string, string>
): MiningStepInput {
  const mapped = mergedSlugs[step.activitySlug];
  if (!mapped) {
    return step;
  }
  return {
    ...step,
    activityId: activityId(mapped),
    activityLabel: humanizeSlug(mapped),
    activitySlug: mapped,
  };
}

function applyEdit(
  edit: DesignedGraphEdit,
  workflow: EditableWorkflow,
  mergedSlugs: Map<string, string>
) {
  switch (edit.action) {
    case "add_edge":
      addEdge(workflow, edit.payload);
      break;
    case "add_node":
      addNode(workflow, edit.payload);
      break;
    case "merge_nodes":
      mergeNodes(workflow, edit.payload, mergedSlugs);
      break;
    case "remove_edge":
      removeEdge(workflow, edit.payload);
      break;
    case "remove_node":
      removeNode(workflow, String(edit.payload.slug ?? ""));
      break;
    case "rename_node":
      renameNode(workflow, edit.payload);
      break;
    default:
      break;
  }
}

function addNode(
  workflow: EditableWorkflow,
  payload: DesignedGraphEditPayload
) {
  const slug = String(payload.slug ?? "");
  if (!slug || workflow.activities.some((activity) => activity.slug === slug)) {
    return;
  }
  const requestedRank =
    typeof payload.rank === "number" && Number.isInteger(payload.rank)
      ? payload.rank
      : workflow.activities.length;
  const rank = Math.min(Math.max(0, requestedRank), workflow.activities.length);
  workflow.activities.splice(rank, 0, {
    id: activityId(slug),
    label: String(payload.label ?? humanizeSlug(slug)),
    policyIds: [],
    rank,
    roleExpected:
      typeof payload.role_expected === "string" ? payload.role_expected : null,
    slug,
  });
  rerank(workflow);
}

function removeNode(workflow: EditableWorkflow, slug: string) {
  const existing = workflow.activities.find(
    (activity) => activity.slug === slug
  );
  if (!existing) {
    return;
  }
  workflow.activities = workflow.activities.filter(
    (activity) => activity.slug !== slug
  );
  workflow.edges = workflow.edges.filter(
    (edge) => edge.source !== slug && edge.target !== slug
  );
  if (workflow.entryActivitySlug === slug) {
    workflow.entryActivitySlug = workflow.activities[0]?.slug;
  }
  workflow.exitActivitySlugs = workflow.exitActivitySlugs.filter(
    (exit) => exit !== slug
  );
  rerank(workflow);
}

function renameNode(
  workflow: EditableWorkflow,
  payload: DesignedGraphEditPayload
) {
  const slug = String(payload.slug ?? "");
  const label = String(payload.label ?? "").trim();
  const existing = workflow.activities.find(
    (activity) => activity.slug === slug
  );
  if (existing && label) {
    existing.label = label;
  }
}

function mergeNodes(
  workflow: EditableWorkflow,
  payload: DesignedGraphEditPayload,
  mergedSlugs: Map<string, string>
) {
  const source = String(payload.source_slug ?? payload.source ?? "");
  const target = String(payload.target_slug ?? payload.target ?? "");
  if (!(source && target) || source === target) {
    return;
  }
  const sourceActivity = workflow.activities.find(
    (activity) => activity.slug === source
  );
  const targetActivity = workflow.activities.find(
    (activity) => activity.slug === target
  );
  if (!(sourceActivity && targetActivity)) {
    return;
  }
  if (typeof payload.label === "string" && payload.label.trim()) {
    targetActivity.label = payload.label.trim();
  }
  for (const [from, to] of [...mergedSlugs]) {
    if (to === source) {
      mergedSlugs.set(from, target);
    }
  }
  mergedSlugs.set(source, target);
  workflow.edges = dedupeEdges(
    workflow.edges
      .map((edge) => ({
        ...edge,
        source: edge.source === source ? target : edge.source,
        target: edge.target === source ? target : edge.target,
      }))
      .filter((edge) => edge.source !== edge.target)
  );
  workflow.activities = workflow.activities.filter(
    (activity) => activity.slug !== source
  );
  if (workflow.entryActivitySlug === source) {
    workflow.entryActivitySlug = target;
  }
  workflow.exitActivitySlugs = workflow.exitActivitySlugs.map((exit) =>
    exit === source ? target : exit
  );
  workflow.exitActivitySlugs = [...new Set(workflow.exitActivitySlugs)];
  rerank(workflow);
}

function addEdge(
  workflow: EditableWorkflow,
  payload: DesignedGraphEditPayload
) {
  const source = String(payload.from_slug ?? payload.source ?? "");
  const target = String(payload.to_slug ?? payload.target ?? "");
  if (
    !(hasActivity(workflow, source) && hasActivity(workflow, target)) ||
    source === target
  ) {
    return;
  }
  const probability =
    typeof payload.probability === "number" &&
    Number.isFinite(payload.probability)
      ? Math.min(Math.max(0, payload.probability), 1)
      : DEFAULT_EDGE_PROBABILITY;
  const existing = workflow.edges.find(
    (edge) => edge.source === source && edge.target === target
  );
  if (existing) {
    existing.probability = probability;
    return;
  }
  workflow.edges.push({
    kind: payload.kind === "approval" ? "approval" : "sequence",
    probability,
    source,
    target,
  });
}

function removeEdge(
  workflow: EditableWorkflow,
  payload: DesignedGraphEditPayload
) {
  const source = String(payload.from_slug ?? payload.source ?? "");
  const target = String(payload.to_slug ?? payload.target ?? "");
  workflow.edges = workflow.edges.filter(
    (edge) => !(edge.source === source && edge.target === target)
  );
}

function toEditableWorkflow(base: DesignedWorkflowInput): EditableWorkflow {
  const activities = base.activities
    .map((activity, index) => ({
      id: activity.id ?? activityId(activity.slug),
      label: activity.label ?? humanizeSlug(activity.slug),
      policyIds: activity.policyIds ?? [],
      rank: activity.rank ?? index,
      roleExpected: activity.roleExpected ?? null,
      slug: activity.slug,
    }))
    .sort((a, b) => a.rank - b.rank || a.slug.localeCompare(b.slug));
  const edges =
    base.edges?.map((edge) => ({
      kind: edge.kind ?? "sequence",
      probability: edge.probability ?? DEFAULT_EDGE_PROBABILITY,
      source:
        edge.sourceActivitySlug ?? slugFromActivityId(edge.sourceActivityId),
      target:
        edge.targetActivitySlug ?? slugFromActivityId(edge.targetActivityId),
    })) ?? [];
  return {
    activities,
    edges: dedupeEdges(
      edges.filter(
        (edge) => edge.source && edge.target && edge.source !== edge.target
      )
    ),
    entryActivitySlug: base.entryActivitySlug,
    exitActivitySlugs: base.exitActivitySlugs ?? [],
    id: base.id,
    name: base.name,
    projectId: base.projectId,
  };
}

function fromEditableWorkflow(
  workflow: EditableWorkflow
): DesignedWorkflowInput {
  const activities = workflow.activities.map((activity, rank) => ({
    id: activity.id,
    label: activity.label,
    policyIds: activity.policyIds,
    rank,
    roleExpected: activity.roleExpected,
    slug: activity.slug,
  }));
  return {
    activities,
    edges: workflow.edges.map((edge) => ({
      kind: edge.kind,
      probability: edge.probability,
      sourceActivityId: activityId(edge.source),
      sourceActivitySlug: edge.source,
      targetActivityId: activityId(edge.target),
      targetActivitySlug: edge.target,
    })),
    entryActivitySlug: workflow.entryActivitySlug,
    exitActivitySlugs: workflow.exitActivitySlugs,
    id: workflow.id,
    matrix: matrixFor(activities, workflow.edges),
    name: workflow.name,
    projectId: workflow.projectId,
  };
}

function matrixFor(
  activities: DesignedWorkflowInput["activities"],
  edges: EditableEdge[]
) {
  const indexBySlug = new Map(
    activities.map((activity, index) => [activity.slug, index])
  );
  const matrix = activities.map(() => activities.map(() => 0));
  for (const edge of edges) {
    const source = indexBySlug.get(edge.source);
    const target = indexBySlug.get(edge.target);
    const row = source === undefined ? undefined : matrix[source];
    if (row && target !== undefined) {
      row[target] = edge.probability;
    }
  }
  return matrix;
}

function dedupeEdges(edges: EditableEdge[]) {
  const byPair = new Map<string, EditableEdge>();
  for (const edge of edges) {
    byPair.set(`${edge.source}\0${edge.target}`, edge);
  }
  return [...byPair.values()].sort(
    (a, b) =>
      a.source.localeCompare(b.source) || a.target.localeCompare(b.target)
  );
}

function hasActivity(workflow: EditableWorkflow, slug: string) {
  return workflow.activities.some((activity) => activity.slug === slug);
}

function rerank(workflow: EditableWorkflow) {
  workflow.activities.forEach((activity, index) => {
    activity.rank = index;
  });
}

function slugFromActivityId(id: string | undefined) {
  return id?.startsWith("act_") ? id.slice(4) : (id ?? "");
}

function activityId(slug: string) {
  return `act_${slug}`;
}

function humanizeSlug(slug: string) {
  return slug
    .split("_")
    .filter(Boolean)
    .map((part) => `${part.slice(0, 1).toUpperCase()}${part.slice(1)}`)
    .join(" ");
}
