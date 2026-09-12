import {
  type ActivityEvent,
  type Conformance,
  type DesignedModel,
  type GraphEdit,
  type GraphEditAction,
  type GraphPlane,
  mine,
  type ProcessEdge,
  type ProcessModel,
  type ProcessNode,
  type WorkflowId,
} from "./process.ts";
import { paths } from "./simulation.ts";

const activityRoles = new Map<string, string>([
  ["Access granted", "IT"],
  ["Access requested", "Operations"],
  ["Approved", "Team lead"],
  ["Changes requested", "Compliance"],
  ["Contract signed", "Finance"],
  ["Customer notified", "Support"],
  ["Details updated", "Operations"],
  ["Eligibility checked", "Support"],
  ["Escalated", "Team lead"],
  ["Manager review", "Team lead"],
  ["Refund issued", "Finance"],
  ["Refund requested", "Support"],
  ["Request closed", "IT"],
  ["Request received", "Operations"],
  ["Risk review", "Compliance"],
  ["Security review", "Compliance"],
]);

export interface EditableGraphResult {
  conformance: Conformance;
  designed: DesignedModel;
  model: ProcessModel & { revision: string };
  revision: string;
}

interface EffectiveEdits {
  designed: DesignedModel;
  hiddenEdges: Set<string>;
  hiddenNodes: Set<string>;
  labels: Map<string, string>;
  merges: Map<string, string>;
}

interface CombinedNode extends ProcessNode {
  grounded: number;
  plane: GraphPlane;
  roleExpected?: string;
}

interface CombinedEdge extends ProcessEdge {
  plane: GraphPlane;
}

export function editableGraph(
  events: ActivityEvent[],
  workflow: WorkflowId,
  edits: GraphEdit[]
): EditableGraphResult {
  const base = baseDesignedModel(workflow);
  const effective = applyEffectiveEdits(base, edits);
  const mined = mine(events);
  const model = projectModel(mined, effective, revisionFor(edits));
  return {
    conformance: scoreEditableConformance(model, effective.designed),
    designed: effective.designed,
    model,
    revision: model.revision,
  };
}

export function prepareGraphEdit({
  action,
  edits,
  events,
  payload,
  workflow,
}: {
  action: string;
  edits: GraphEdit[];
  events: ActivityEvent[];
  payload: unknown;
  workflow: WorkflowId;
}): { action: GraphEditAction; payload: Record<string, string> } {
  if (!isGraphEditAction(action)) {
    throw new Error("Unknown graph edit action.");
  }
  if (!(payload && typeof payload === "object" && !Array.isArray(payload))) {
    throw new Error("Edit payload must be an object.");
  }
  const request = translateCurationRequest(
    action,
    normalizePayload(payload as Record<string, unknown>)
  );
  const current = editableGraph(events, workflow, edits);
  validateGraphEdit(
    request.action,
    request.payload,
    current.model,
    current.designed
  );
  return request;
}

export function baseDesignedModel(workflow: WorkflowId): DesignedModel {
  const mainPath = paths[workflow][0] ?? [];
  const activities = mainPath.map((label) => ({
    label,
    role: activityRoles.get(label) ?? "Owner",
    slug: label,
  }));
  const matrix = activities.map((_, rowIndex) =>
    activities.map((__, columnIndex) => (columnIndex === rowIndex + 1 ? 1 : 0))
  );
  return {
    activities,
    entry: activities[0]?.slug ?? "",
    matrix,
    policies: [],
    workflow,
  };
}

function applyEffectiveEdits(
  base: DesignedModel,
  edits: GraphEdit[]
): EffectiveEdits {
  const effective: EffectiveEdits = {
    designed: cloneDesigned(base),
    hiddenEdges: new Set(),
    hiddenNodes: new Set(),
    labels: new Map(),
    merges: new Map(),
  };
  for (const edit of edits
    .filter((item) => !item.undone)
    .sort(
      (a, b) =>
        a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id)
    )) {
    applySingleEdit(effective, edit);
  }
  return effective;
}

function applySingleEdit(effective: EffectiveEdits, edit: GraphEdit) {
  switch (edit.action) {
    case "add_node":
    case "promote":
      applyNodeAddition(effective, edit.payload);
      break;
    case "retire":
      applyNodeRetirement(effective, edit.payload);
      break;
    case "reject":
    case "remove_node":
      applyNodeRemoval(effective, edit.payload);
      break;
    case "add_edge":
    case "require":
      applyEdgeAddition(effective, edit.payload);
      break;
    case "remove_edge":
      applyEdgeRemoval(effective, edit.payload);
      break;
    case "merge":
      applyMerge(effective, edit.payload);
      break;
    case "rename":
      applyRename(effective, edit.payload);
      break;
    default:
      break;
  }
}

function editNodeId(payload: Record<string, string>) {
  return payload.id ?? payload.node ?? payload.nodeId;
}

function applyNodeAddition(
  effective: EffectiveEdits,
  payload: Record<string, string>
) {
  const id = editNodeId(payload);
  if (!id) {
    return;
  }
  addDesignedActivity(effective.designed, {
    label: payload.label ?? id,
    role: payload.role ?? activityRoles.get(id) ?? "Owner",
    slug: id,
  });
  effective.hiddenNodes.delete(id);
}

function applyNodeRetirement(
  effective: EffectiveEdits,
  payload: Record<string, string>
) {
  const id = editNodeId(payload);
  if (id) {
    removeDesignedActivity(effective.designed, id);
  }
}

function applyNodeRemoval(
  effective: EffectiveEdits,
  payload: Record<string, string>
) {
  const id = editNodeId(payload);
  if (!id) {
    return;
  }
  removeDesignedActivity(effective.designed, id);
  effective.hiddenNodes.add(id);
}

function applyEdgeAddition(
  effective: EffectiveEdits,
  payload: Record<string, string>
) {
  if (!(payload.source && payload.target)) {
    return;
  }
  addDesignedEdge(effective.designed, payload.source, payload.target);
  effective.hiddenEdges.delete(edgeId(payload.source, payload.target));
}

function applyEdgeRemoval(
  effective: EffectiveEdits,
  payload: Record<string, string>
) {
  if (!(payload.source && payload.target)) {
    return;
  }
  removeDesignedEdge(effective.designed, payload.source, payload.target);
  effective.hiddenEdges.add(edgeId(payload.source, payload.target));
}

function applyMerge(
  effective: EffectiveEdits,
  payload: Record<string, string>
) {
  if (payload.source && payload.target && payload.source !== payload.target) {
    mergeDesignedActivity(effective, payload.source, payload.target);
  }
}

function applyRename(
  effective: EffectiveEdits,
  payload: Record<string, string>
) {
  const id = editNodeId(payload);
  if (!(id && payload.label)) {
    return;
  }
  renameDesignedActivity(effective.designed, id, payload.label);
  effective.labels.set(id, payload.label);
}

function projectModel(
  mined: ProcessModel,
  effective: EffectiveEdits,
  revision: string
): ProcessModel & { revision: string } {
  const nodes = combineNodes(mined.nodes, effective);
  const edges = combineEdges(mined.edges, effective, nodes);
  const variants = mined.variants.map((variant) => ({
    ...variant,
    path: compactPath(
      variant.path.map((id) =>
        effective.hiddenNodes.has(id) ? "" : resolveMerge(id, effective.merges)
      )
    ),
  }));
  return {
    ...mined,
    edges,
    nodes,
    revision,
    variants,
  };
}

function combineNodes(minedNodes: ProcessNode[], effective: EffectiveEdits) {
  const designedBySlug = new Map(
    effective.designed.activities.map((activity) => [activity.slug, activity])
  );
  const combined = new Map<string, CombinedNode>();
  for (const node of minedNodes) {
    const id = resolveMerge(node.id, effective.merges);
    if (effective.hiddenNodes.has(node.id) && id === node.id) {
      continue;
    }
    const designed = designedBySlug.get(id);
    const existing = combined.get(id);
    combined.set(id, {
      actors: mergeUnique(existing?.actors ?? [], node.actors),
      count: (existing?.count ?? 0) + node.count,
      grounded: (existing?.grounded ?? 0) + (node.grounded ?? node.count),
      id,
      label: effective.labels.get(id) ?? designed?.label ?? node.label,
      plane: designed ? "both" : "discovered",
      role: node.role,
      roleExpected: designed?.role,
      terminal: (existing?.terminal ?? true) && node.terminal,
    });
  }
  for (const activity of effective.designed.activities) {
    if (effective.hiddenNodes.has(activity.slug)) {
      continue;
    }
    if (!combined.has(activity.slug)) {
      combined.set(activity.slug, {
        actors: [],
        count: 0,
        grounded: 0,
        id: activity.slug,
        label: activity.label,
        plane: "designed",
        role: activity.role,
        roleExpected: activity.role,
        terminal: !hasOutgoingDesignedEdge(effective.designed, activity.slug),
      });
    }
  }
  return [...combined.values()].sort(
    (a, b) =>
      planeRank(a.plane) - planeRank(b.plane) || a.label.localeCompare(b.label)
  );
}

function combineEdges(
  minedEdges: ProcessEdge[],
  effective: EffectiveEdits,
  nodes: CombinedNode[]
) {
  const nodeIds = new Set(nodes.map((node) => node.id));
  const combined = new Map<string, CombinedEdge>();
  const addEdge = (edge: ProcessEdge, observed: boolean, designed: boolean) => {
    const source = resolveMerge(edge.source, effective.merges);
    const target = resolveMerge(edge.target, effective.merges);
    const id = edgeId(source, target);
    if (
      source === target ||
      effective.hiddenEdges.has(edge.id) ||
      effective.hiddenEdges.has(id) ||
      !nodeIds.has(source) ||
      !nodeIds.has(target)
    ) {
      return;
    }
    const existing = combined.get(id);
    const hasObserved = observed || (existing?.count ?? 0) > 0;
    const hasDesign =
      designed || existing?.plane === "designed" || existing?.plane === "both";
    combined.set(id, {
      cases: Math.max(existing?.cases ?? 0, edge.cases),
      count: (existing?.count ?? 0) + edge.count,
      evidence: [...(existing?.evidence ?? []), ...edge.evidence],
      id,
      isBackEdge: existing?.isBackEdge || edge.isBackEdge,
      medianMinutes:
        existing && edge.count
          ? (existing.medianMinutes + edge.medianMinutes) / 2
          : edge.medianMinutes,
      plane: planeFor(hasDesign, hasObserved),
      probability: Math.max(existing?.probability ?? 0, edge.probability),
      source,
      target,
      violates: mergeUnique(existing?.violates ?? [], edge.violates ?? []),
    });
  };
  for (const edge of minedEdges) {
    addEdge(
      edge,
      true,
      hasDesignedEdge(effective.designed, edge.source, edge.target)
    );
  }
  for (const edge of designedEdges(effective.designed)) {
    addEdge(edge, false, true);
  }
  const outgoing = new Map<string, number>();
  for (const edge of combined.values()) {
    if (edge.count > 0) {
      outgoing.set(edge.source, (outgoing.get(edge.source) ?? 0) + edge.count);
    }
  }
  return [...combined.values()]
    .map((edge) => ({
      ...edge,
      probability: edge.count
        ? edge.count / (outgoing.get(edge.source) ?? edge.count)
        : edge.probability,
    }))
    .sort(
      (a, b) =>
        a.source.localeCompare(b.source) || a.target.localeCompare(b.target)
    );
}

function scoreEditableConformance(
  model: ProcessModel,
  designed: DesignedModel
): Conformance {
  const designedSlugs = new Set(
    designed.activities.map((activity) => activity.slug)
  );
  const observedNodes = model.nodes.filter((node) => node.count > 0);
  const missing = designed.activities
    .filter(
      (activity) =>
        (model.nodes.find((node) => node.id === activity.slug)?.count ?? 0) ===
        0
    )
    .map((activity) => ({
      of: model.stats.cases,
      seenIn: 0,
      slug: activity.slug,
    }));
  const extra = observedNodes
    .filter((node) => !designedSlugs.has(node.id))
    .map((node) => ({ count: node.count, slug: node.id }));
  const designedPairs = new Set(designedEdges(designed).map((edge) => edge.id));
  const orderBreaks = model.edges
    .filter((edge) => edge.count > 0 && !designedPairs.has(edge.id))
    .map((edge) => ({
      expectedBetween: "documented transition",
      from: edge.source,
      to: edge.target,
    }));
  const designedCount = Math.max(designed.activities.length, 1);
  const observedCount = Math.max(observedNodes.length, 1);
  return {
    extra,
    fitness: clamp01(
      (designed.activities.length - missing.length) / designedCount
    ),
    grounded: observedNodes.reduce(
      (sum, node) => sum + (node.grounded ?? node.count),
      0
    ),
    missing,
    orderBreaks,
    precision: clamp01((observedNodes.length - extra.length) / observedCount),
    roleDeviations: model.nodes
      .filter(
        (node) =>
          node.roleExpected && node.count > 0 && node.role !== node.roleExpected
      )
      .map((node) => ({
        expected: node.roleExpected ?? "",
        observed: [node.role],
        slug: node.id,
      })),
    violations: [],
  };
}

function normalizePayload(payload: Record<string, unknown>) {
  const normalized: Record<string, string> = {};
  for (const [key, value] of Object.entries(payload)) {
    if (typeof value !== "string") {
      continue;
    }
    const trimmed = value.trim();
    if (trimmed) {
      normalized[key] = trimmed;
    }
  }
  return normalized;
}

function translateCurationRequest(
  action: GraphEditAction,
  payload: Record<string, string>
): { action: GraphEditAction; payload: Record<string, string> } {
  if (!(payload.target_id && payload.target_kind)) {
    return { action, payload };
  }
  if (payload.target_kind === "node") {
    if (action === "merge") {
      return {
        action,
        payload: {
          source: payload.target_id,
          target: payload.merge_target_id ?? "",
        },
      };
    }
    if (action === "reject") {
      return { action, payload: { id: payload.target_id } };
    }
    if (action === "confirm") {
      return { action, payload: { id: payload.target_id } };
    }
  }
  if (payload.target_kind === "edge") {
    const [source, target] = payload.target_id.split("::");
    if (action === "reject") {
      return {
        action: "remove_edge",
        payload: { source: source ?? "", target: target ?? "" },
      };
    }
    if (action === "confirm") {
      return { action, payload: { id: payload.target_id } };
    }
  }
  return { action, payload };
}

function validateGraphEdit(
  action: GraphEditAction,
  payload: Record<string, string>,
  model: ProcessModel,
  designed: DesignedModel
) {
  const nodeIds = new Set(model.nodes.map((node) => node.id));
  const designedIds = new Set(
    designed.activities.map((activity) => activity.slug)
  );
  switch (action) {
    case "add_node":
      validateAddNode(payload, nodeIds, designedIds);
      break;
    case "promote":
      validatePromote(payload, nodeIds, designedIds);
      break;
    case "retire":
      assertNode(payload.id, designedIds);
      break;
    case "reject":
    case "remove_node":
      assertNode(payload.id, nodeIds);
      break;
    case "rename":
      validateRename(payload, nodeIds);
      break;
    case "merge":
      validateMerge(payload, nodeIds);
      break;
    case "add_edge":
    case "require":
      validateEdgeEndpoints(payload, nodeIds);
      break;
    case "remove_edge":
      validateRemoveEdge(payload, nodeIds, model);
      break;
    default:
      break;
  }
}

function validateAddNode(
  payload: Record<string, string>,
  nodeIds: Set<string>,
  designedIds: Set<string>
) {
  const id = validNodeId(payload.id ?? payload.label);
  if (nodeIds.has(id) || designedIds.has(id)) {
    throw new Error("A node with that label already exists.");
  }
  payload.id = id;
  payload.label = payload.label ?? id;
}

function validatePromote(
  payload: Record<string, string>,
  nodeIds: Set<string>,
  designedIds: Set<string>
) {
  const { id } = payload;
  assertNode(id, nodeIds);
  if (designedIds.has(id)) {
    throw new Error("Only discovered nodes can be promoted.");
  }
}

function validateRename(payload: Record<string, string>, nodeIds: Set<string>) {
  assertNode(payload.id, nodeIds);
  payload.label = validNodeId(payload.label);
}

function validateMerge(payload: Record<string, string>, nodeIds: Set<string>) {
  assertNode(payload.source, nodeIds);
  assertNode(payload.target, nodeIds);
  if (payload.source === payload.target) {
    throw new Error("Choose two different nodes to merge.");
  }
}

function validateEdgeEndpoints(
  payload: Record<string, string>,
  nodeIds: Set<string>
) {
  const { source, target } = payload;
  assertNode(source, nodeIds);
  assertNode(target, nodeIds);
  if (source === target) {
    throw new Error("Choose two different nodes for the edge.");
  }
}

function validateRemoveEdge(
  payload: Record<string, string>,
  nodeIds: Set<string>,
  model: ProcessModel
) {
  validateEdgeEndpoints(payload, nodeIds);
  const { source, target } = payload;
  assertNode(source, nodeIds);
  assertNode(target, nodeIds);
  const existing = new Set(model.edges.map((edge) => edge.id));
  if (!existing.has(edgeId(source, target))) {
    throw new Error("That edge is not present in the graph.");
  }
}

function isGraphEditAction(action: string): action is GraphEditAction {
  return [
    "add_edge",
    "add_node",
    "confirm",
    "merge",
    "promote",
    "reject",
    "remove_edge",
    "remove_node",
    "rename",
    "require",
    "retire",
  ].includes(action);
}

function assertNode(
  value: string | undefined,
  nodes: Set<string>
): asserts value is string {
  if (!(value && nodes.has(value))) {
    throw new Error("Choose an existing graph node.");
  }
}

function validNodeId(value: string | undefined) {
  const label = value?.trim();
  if (!(label && label.length <= 60 && !label.includes("::"))) {
    throw new Error(
      "Node labels must be 1 to 60 characters and cannot contain ::."
    );
  }
  return label;
}

function revisionFor(edits: GraphEdit[]) {
  const active = edits.filter((edit) => !edit.undone);
  return `${active.length}:${active.at(-1)?.id ?? "base"}`;
}

function cloneDesigned(designed: DesignedModel): DesignedModel {
  return {
    activities: designed.activities.map((activity) => ({
      ...activity,
      synonyms: activity.synonyms ? [...activity.synonyms] : undefined,
    })),
    entry: designed.entry,
    matrix: designed.matrix.map((row) => [...row]),
    policies: [...designed.policies],
    workflow: designed.workflow,
  };
}

function addDesignedActivity(
  designed: DesignedModel,
  activity: DesignedModel["activities"][number]
) {
  if (designed.activities.some((item) => item.slug === activity.slug)) {
    return;
  }
  designed.activities.push(activity);
  for (const row of designed.matrix) {
    row.push(0);
  }
  designed.matrix.push(
    Array.from({ length: designed.activities.length }, () => 0)
  );
}

function removeDesignedActivity(designed: DesignedModel, slug: string) {
  const index = designed.activities.findIndex(
    (activity) => activity.slug === slug
  );
  if (index === -1) {
    return;
  }
  designed.activities.splice(index, 1);
  designed.matrix.splice(index, 1);
  for (const row of designed.matrix) {
    row.splice(index, 1);
  }
  if (designed.entry === slug) {
    designed.entry = designed.activities[0]?.slug ?? "";
  }
}

function renameDesignedActivity(
  designed: DesignedModel,
  slug: string,
  label: string
) {
  const activity = designed.activities.find((item) => item.slug === slug);
  if (activity) {
    activity.label = label;
    activity.synonyms = mergeUnique(activity.synonyms ?? [], [slug]);
  }
}

function addDesignedEdge(
  designed: DesignedModel,
  source: string,
  target: string
) {
  const sourceIndex = designed.activities.findIndex(
    (activity) => activity.slug === source
  );
  const targetIndex = designed.activities.findIndex(
    (activity) => activity.slug === target
  );
  if (sourceIndex === -1 || targetIndex === -1) {
    return;
  }
  designed.matrix[sourceIndex] = designed.matrix[sourceIndex] ?? [];
  designed.matrix[sourceIndex][targetIndex] = 1;
}

function removeDesignedEdge(
  designed: DesignedModel,
  source: string,
  target: string
) {
  const sourceIndex = designed.activities.findIndex(
    (activity) => activity.slug === source
  );
  const targetIndex = designed.activities.findIndex(
    (activity) => activity.slug === target
  );
  if (sourceIndex === -1 || targetIndex === -1) {
    return;
  }
  designed.matrix[sourceIndex] = designed.matrix[sourceIndex] ?? [];
  designed.matrix[sourceIndex][targetIndex] = 0;
}

function mergeDesignedActivity(
  effective: EffectiveEdits,
  source: string,
  target: string
) {
  const designedEdgesBefore = designedEdges(effective.designed);
  const targetActivity =
    effective.designed.activities.find(
      (activity) => activity.slug === target
    ) ??
    effective.designed.activities.find((activity) => activity.slug === source);
  if (targetActivity && targetActivity.slug === source) {
    targetActivity.slug = target;
    targetActivity.label = effective.labels.get(target) ?? target;
  }
  if (targetActivity) {
    targetActivity.synonyms = mergeUnique(targetActivity.synonyms ?? [], [
      source,
    ]);
  }
  removeDesignedActivity(effective.designed, source);
  for (const edge of designedEdgesBefore) {
    const nextSource = edge.source === source ? target : edge.source;
    const nextTarget = edge.target === source ? target : edge.target;
    if (nextSource !== nextTarget) {
      addDesignedEdge(effective.designed, nextSource, nextTarget);
    }
  }
  effective.merges.set(source, target);
  effective.hiddenNodes.add(source);
}

function designedEdges(designed: DesignedModel): ProcessEdge[] {
  const edges: ProcessEdge[] = [];
  designed.matrix.forEach((row, rowIndex) => {
    const source = designed.activities[rowIndex];
    if (!source) {
      return;
    }
    row.forEach((weight, columnIndex) => {
      const target = designed.activities[columnIndex];
      if (target && weight > 0) {
        edges.push({
          cases: 0,
          count: 0,
          evidence: [],
          id: edgeId(source.slug, target.slug),
          medianMinutes: 0,
          plane: "designed",
          probability: weight,
          source: source.slug,
          target: target.slug,
        });
      }
    });
  });
  return edges;
}

function hasDesignedEdge(
  designed: DesignedModel,
  source: string,
  target: string
) {
  return designedEdges(designed).some(
    (edge) => edge.source === source && edge.target === target
  );
}

function hasOutgoingDesignedEdge(designed: DesignedModel, source: string) {
  return designedEdges(designed).some((edge) => edge.source === source);
}

function resolveMerge(id: string, merges: Map<string, string>): string {
  let current = id;
  const seen = new Set<string>();
  while (merges.has(current) && !seen.has(current)) {
    seen.add(current);
    current = merges.get(current) ?? current;
  }
  return current;
}

function compactPath(path: string[]) {
  return path.filter((item, index) => item && item !== path[index - 1]);
}

function edgeId(source: string, target: string) {
  return `${source}::${target}`;
}

function planeFor(designed: boolean, observed: boolean): GraphPlane {
  if (designed && observed) {
    return "both";
  }
  return designed ? "designed" : "discovered";
}

function planeRank(plane: GraphPlane) {
  return { both: 0, designed: 2, discovered: 1 }[plane];
}

function mergeUnique(first: string[], second: string[]) {
  return [...new Set([...first, ...second])];
}

function clamp01(value: number) {
  return Math.max(0, Math.min(1, Number.isFinite(value) ? value : 0));
}
