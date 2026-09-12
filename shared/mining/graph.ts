export type LifecycleState =
  | "requested"
  | "committed"
  | "in_progress"
  | "done"
  | "failed"
  | "skipped"
  | "abandoned";

export type CurationStatus = "proposed" | "confirmed" | "rejected";
export type StepType =
  | "action"
  | "decision"
  | "handoff"
  | "wait"
  | "rework"
  | "approval";
export type WorkModality = "reported" | "committed" | "requested" | "negated";
export type ActivityPlane = "designed" | "discovered" | "both";
export type EdgeKind =
  | "sequence"
  | "handoff"
  | "decision"
  | "approval"
  | "rework";

export interface MiningScope {
  projectId?: string;
  workflowId?: string;
}

export interface MiningSessionInput {
  id: string;
  projectId?: string | null;
  workflowId?: string | null;
}

export interface MiningStepInput {
  activityId?: string | null;
  activityLabel?: string | null;
  activitySlug: string;
  actorPersonId?: string | null;
  actorRole?: string | null;
  curation?: CurationStatus;
  evidence?: string[];
  handoffToPersonId?: string | null;
  id: string;
  lifecycle?: LifecycleState;
  modality?: WorkModality;
  negated?: boolean;
  projectId?: string | null;
  seq: number;
  sessionId: string;
  state?: LifecycleState;
  status?: CurationStatus;
  tsEnd?: string | null;
  tsStart?: string | null;
  type: StepType;
  workflowId?: string | null;
}

export interface DesignedActivityInput {
  id?: string;
  label?: string;
  policyIds?: string[];
  rank?: number;
  roleExpected?: string | null;
  slug: string;
}

export interface DesignedEdgeInput {
  kind?: EdgeKind;
  probability?: number;
  sourceActivityId?: string;
  sourceActivitySlug?: string;
  targetActivityId?: string;
  targetActivitySlug?: string;
}

export interface DesignedWorkflowInput {
  activities: DesignedActivityInput[];
  edges?: DesignedEdgeInput[];
  entryActivityId?: string;
  entryActivitySlug?: string;
  exitActivityIds?: string[];
  exitActivitySlugs?: string[];
  id: string;
  matrix?: number[][];
  name?: string;
  projectId?: string | null;
}

export interface BuildGraphInput {
  scope?: MiningScope;
  sessions?: MiningSessionInput[];
  steps: MiningStepInput[];
  workflows?: DesignedWorkflowInput[];
}

export interface RoleMetric {
  count: number;
  role: string;
}

export interface AggregateNode {
  avgDwellSeconds: number | null;
  designed: boolean;
  designedRank: number | null;
  firstSeenTs: string | null;
  handoffCount: number;
  id: string;
  label: string;
  occurrences: number;
  plane: ActivityPlane;
  policyIds: string[];
  reworkRate: number;
  roleExpected: string | null;
  roles: RoleMetric[];
  slug: string;
  support: number;
}

export interface EdgeEvidence {
  fromStepId: string;
  sessionId: string;
  toStepId: string;
}

export interface AggregateEdge {
  cases: string[];
  designedProbability: number | null;
  id: string;
  isBackEdge: boolean;
  kind: EdgeKind;
  occurrences: number;
  plane: ActivityPlane;
  probability: number;
  source: string;
  support: number;
  target: string;
  transitions: EdgeEvidence[];
}

export interface InstanceNode {
  accepted: true;
  activityId: string;
  activitySlug: string;
  actorPersonId: string | null;
  actorRole: string | null;
  id: string;
  plane: ActivityPlane;
  seq: number;
  sessionId: string;
  type: StepType;
}

export interface InstanceEdge {
  fromStepId: string;
  id: string;
  kind: EdgeKind;
  sessionId: string;
  toStepId: string;
}

export interface InstanceGraph {
  edges: InstanceEdge[];
  nodes: InstanceNode[];
}

export interface VariantSummary {
  count: number;
  path: string[];
  sessionIds: string[];
  signature: string;
}

export interface HappyPathStep {
  activityId: string;
  slug: string;
}

export interface GraphStats {
  acceptedSteps: number;
  designedActivities: number;
  discoveredActivities: number;
  handoffs: number;
  sessions: number;
  variants: number;
}

export interface AggregateGraph {
  edges: AggregateEdge[];
  happyPath: HappyPathStep[];
  instanceGraph: InstanceGraph;
  nodes: AggregateNode[];
  revision: string;
  scope: MiningScope;
  stats: GraphStats;
  variants: VariantSummary[];
}

export interface GraphDiff<TNode, TEdge> {
  added: { edges: TEdge[]; nodes: TNode[] };
  fromRevision: string | null;
  removed: { edges: TEdge[]; nodes: TNode[] };
  toRevision: string;
  updated: { edges: TEdge[]; nodes: TNode[] };
}

interface SessionContext {
  id: string;
  projectId: string | null;
  workflowId: string | null;
}

interface DesignedActivity {
  id: string;
  label: string;
  policyIds: string[];
  rank: number | null;
  roleExpected: string | null;
  slug: string;
  workflowIds: string[];
}

interface DesignedEdge {
  kind: EdgeKind;
  probability: number;
  source: string;
  target: string;
}

interface DesignedOverlay {
  activitiesById: Map<string, DesignedActivity>;
  activitiesBySlug: Map<string, DesignedActivity>;
  edges: DesignedEdge[];
  entryActivityId: string | null;
  exitActivityIds: string[];
}

interface CanonicalStep {
  activityId: string;
  activityLabel: string;
  activitySlug: string;
  actorPersonId: string | null;
  actorRole: string | null;
  evidence: string[];
  handoffToPersonId: string | null;
  id: string;
  seq: number;
  session: SessionContext;
  tsEnd: string | null;
  tsStart: string | null;
  type: StepType;
}

interface NodeAccumulator {
  designed: boolean;
  designedRank: number | null;
  dwellSeconds: number[];
  firstSeenTs: string | null;
  handoffCount: number;
  id: string;
  label: string;
  occurrences: number;
  policyIds: string[];
  repeatedSessions: Set<string>;
  roleExpected: string | null;
  roles: Map<string, number>;
  slug: string;
  support: Set<string>;
}

interface EdgeAccumulator {
  designed: boolean;
  designedProbability: number | null;
  evidence: EdgeEvidence[];
  kindCounts: Map<EdgeKind, number>;
  occurrences: number;
  source: string;
  support: Set<string>;
  target: string;
}

const EDGE_KIND_PRIORITY = new Map<EdgeKind, number>([
  ["rework", 0],
  ["approval", 1],
  ["decision", 2],
  ["handoff", 3],
  ["sequence", 4],
]);

export function buildAggregateGraph(input: BuildGraphInput): AggregateGraph {
  const scope = input.scope ?? {};
  const sessions = buildSessionContexts(input.sessions ?? []);
  const designed = buildDesignedOverlay(input.workflows ?? [], scope);
  const scopedAcceptedSteps = input.steps
    .filter((step) => isAcceptedStep(step))
    .map((step) => canonicalizeStep(step, sessions, designed))
    .filter(
      (step): step is CanonicalStep =>
        step !== null && contextMatchesScope(step.session, scope)
    )
    .sort(compareCanonicalSteps);

  const nodes = seedDesignedNodes(designed);
  const edges = seedDesignedEdges(designed);
  const dwellCache = new Map<string, number | null>();
  const stepsBySession = groupStepsBySession(scopedAcceptedSteps);
  applyObservedSteps(stepsBySession, nodes, edges, dwellCache);

  const aggregateNodes = [...nodes.values()]
    .map(toAggregateNode)
    .sort(compareAggregateNodes);
  const aggregateEdges = markBackEdges(
    [...edges.values()].map(toAggregateEdge)
  ).sort(compareAggregateEdges);

  const variants = buildVariants(stepsBySession);
  const graphWithoutRevision = {
    edges: aggregateEdges,
    happyPath: buildHappyPath(
      aggregateNodes,
      aggregateEdges,
      designed.entryActivityId,
      designed.exitActivityIds
    ),
    instanceGraph: buildInstanceGraph(
      scopedAcceptedSteps,
      aggregateNodes,
      stepsBySession
    ),
    nodes: aggregateNodes,
    scope,
    stats: buildStats(
      aggregateNodes,
      aggregateEdges,
      stepsBySession.size,
      scopedAcceptedSteps.length,
      variants.length
    ),
    variants,
  };

  return {
    ...graphWithoutRevision,
    revision: makeRevision(revisionInputForGraph(graphWithoutRevision)),
  };
}

export function diffAggregateGraphs(
  previous: AggregateGraph | null,
  current: AggregateGraph
): GraphDiff<AggregateNode, AggregateEdge> {
  if (previous === null) {
    return {
      added: { edges: current.edges, nodes: current.nodes },
      fromRevision: null,
      removed: { edges: [], nodes: [] },
      toRevision: current.revision,
      updated: { edges: [], nodes: [] },
    };
  }
  return diffById(
    previous.revision,
    current.revision,
    previous.nodes,
    current.nodes,
    previous.edges,
    current.edges
  );
}

function seedDesignedNodes(
  designed: DesignedOverlay
): Map<string, NodeAccumulator> {
  const nodes = new Map<string, NodeAccumulator>();
  for (const activity of designed.activitiesById.values()) {
    nodes.set(activity.id, {
      designed: true,
      designedRank: activity.rank,
      dwellSeconds: [],
      firstSeenTs: null,
      handoffCount: 0,
      id: activity.id,
      label: activity.label,
      occurrences: 0,
      policyIds: [...activity.policyIds].sort(),
      repeatedSessions: new Set<string>(),
      roleExpected: activity.roleExpected,
      roles: new Map<string, number>(),
      slug: activity.slug,
      support: new Set<string>(),
    });
  }
  return nodes;
}

function seedDesignedEdges(
  designed: DesignedOverlay
): Map<string, EdgeAccumulator> {
  const edges = new Map<string, EdgeAccumulator>();
  for (const edge of designed.edges) {
    const accumulator = edgeAccumulator(edges, edge.source, edge.target);
    accumulator.designed = true;
    accumulator.designedProbability = edge.probability;
    accumulator.kindCounts.set(
      edge.kind,
      accumulator.kindCounts.get(edge.kind) ?? 0
    );
  }
  return edges;
}

function applyObservedSteps(
  stepsBySession: Map<string, CanonicalStep[]>,
  nodes: Map<string, NodeAccumulator>,
  edges: Map<string, EdgeAccumulator>,
  dwellCache: Map<string, number | null>
) {
  for (const sessionSteps of stepsBySession.values()) {
    const perSessionCounts = new Map<string, number>();
    const seenActivities = new Set<string>();
    for (const step of sessionSteps) {
      applyStepToNode(step, nodes, perSessionCounts, dwellCache);
    }
    applyTransitionsToEdges(sessionSteps, nodes, edges, seenActivities);
  }
}

function applyStepToNode(
  step: CanonicalStep,
  nodes: Map<string, NodeAccumulator>,
  perSessionCounts: Map<string, number>,
  dwellCache: Map<string, number | null>
) {
  const node =
    nodes.get(step.activityId) ??
    newNodeAccumulator(step.activityId, step.activitySlug, step.activityLabel);
  node.occurrences += 1;
  node.support.add(step.session.id);
  node.firstSeenTs = earliestTimestamp(node.firstSeenTs, step.tsStart);
  const dwell = dwellSeconds(step, dwellCache);
  if (dwell !== null) {
    node.dwellSeconds.push(dwell);
  }
  const role = step.actorRole ?? step.actorPersonId;
  if (role !== null) {
    node.roles.set(role, (node.roles.get(role) ?? 0) + 1);
  }
  const visits = (perSessionCounts.get(step.activityId) ?? 0) + 1;
  perSessionCounts.set(step.activityId, visits);
  if (visits > 1) {
    node.repeatedSessions.add(step.session.id);
  }
  nodes.set(step.activityId, node);
}

function applyTransitionsToEdges(
  sessionSteps: CanonicalStep[],
  nodes: Map<string, NodeAccumulator>,
  edges: Map<string, EdgeAccumulator>,
  seenActivities: Set<string>
) {
  for (let index = 0; index < sessionSteps.length - 1; index += 1) {
    const source = sessionSteps[index];
    const target = sessionSteps[index + 1];
    if (!(source && target)) {
      continue;
    }
    const kind = classifyEdge(source, target, seenActivities);
    seenActivities.add(source.activityId);
    const accumulator = edgeAccumulator(
      edges,
      source.activityId,
      target.activityId
    );
    accumulator.occurrences += 1;
    accumulator.support.add(source.session.id);
    accumulator.evidence.push({
      fromStepId: source.id,
      sessionId: source.session.id,
      toStepId: target.id,
    });
    accumulator.kindCounts.set(
      kind,
      (accumulator.kindCounts.get(kind) ?? 0) + 1
    );
    const targetNode = nodes.get(target.activityId);
    if (kind === "handoff" && targetNode) {
      targetNode.handoffCount += 1;
    }
  }
}

export function isAcceptedStep(step: MiningStepInput): boolean {
  const lifecycle = step.lifecycle ?? step.state;
  const curation = step.curation ?? step.status;
  return (
    lifecycle === "done" &&
    curation === "confirmed" &&
    step.modality !== "negated" &&
    step.negated !== true
  );
}

function buildSessionContexts(
  sessions: MiningSessionInput[]
): Map<string, SessionContext> {
  return new Map(
    sessions.map((session) => [
      session.id,
      {
        id: session.id,
        projectId: session.projectId ?? null,
        workflowId: session.workflowId ?? null,
      },
    ])
  );
}

function buildDesignedOverlay(
  workflows: DesignedWorkflowInput[],
  scope: MiningScope
): DesignedOverlay {
  const activitiesById = new Map<string, DesignedActivity>();
  const activitiesBySlug = new Map<string, DesignedActivity>();
  const edges = new Map<string, DesignedEdge>();
  let entryActivityId: string | null = null;
  const exitActivityIds = new Set<string>();

  for (const workflow of workflows.filter((candidate) =>
    workflowMatchesScope(candidate, scope)
  )) {
    const activityIds = addDesignedActivities(
      workflow,
      activitiesById,
      activitiesBySlug
    );
    entryActivityId ??= resolveEntryActivityId(workflow, activityIds);
    addExitActivityIds(workflow, activityIds, exitActivityIds);
    addDesignedEdges(workflow, activityIds, edges);
    addDesignedMatrixEdges(workflow, activityIds, edges);
  }

  return {
    activitiesById,
    activitiesBySlug,
    edges: [...edges.values()].sort((a, b) =>
      edgeId(a.source, a.target).localeCompare(edgeId(b.source, b.target))
    ),
    entryActivityId,
    exitActivityIds: [...exitActivityIds].sort(),
  };
}

function addDesignedActivities(
  workflow: DesignedWorkflowInput,
  activitiesById: Map<string, DesignedActivity>,
  activitiesBySlug: Map<string, DesignedActivity>
): Map<string, string> {
  const activityIds = new Map<string, string>();
  workflow.activities.forEach((activity, index) => {
    const id = activity.id ?? activityIdForSlug(activity.slug);
    activityIds.set(activity.slug, id);
    const existing = activitiesById.get(id);
    const workflowIds = existing?.workflowIds.includes(workflow.id)
      ? existing.workflowIds
      : [...(existing?.workflowIds ?? []), workflow.id];
    const next: DesignedActivity = {
      id,
      label: activity.label ?? labelFromSlug(activity.slug),
      policyIds: [...(activity.policyIds ?? [])],
      rank: activity.rank ?? index,
      roleExpected: activity.roleExpected ?? null,
      slug: activity.slug,
      workflowIds,
    };
    activitiesById.set(id, next);
    activitiesBySlug.set(activity.slug, next);
  });
  return activityIds;
}

function resolveEntryActivityId(
  workflow: DesignedWorkflowInput,
  activityIds: Map<string, string>
): string | null {
  if (workflow.entryActivityId) {
    return workflow.entryActivityId;
  }
  if (workflow.entryActivitySlug) {
    return activityIds.get(workflow.entryActivitySlug) ?? null;
  }
  return null;
}

function addExitActivityIds(
  workflow: DesignedWorkflowInput,
  activityIds: Map<string, string>,
  exitActivityIds: Set<string>
) {
  for (const exitId of workflow.exitActivityIds ?? []) {
    exitActivityIds.add(exitId);
  }
  for (const exitSlug of workflow.exitActivitySlugs ?? []) {
    const exitId = activityIds.get(exitSlug);
    if (exitId) {
      exitActivityIds.add(exitId);
    }
  }
}

function addDesignedEdges(
  workflow: DesignedWorkflowInput,
  activityIds: Map<string, string>,
  edges: Map<string, DesignedEdge>
) {
  for (const edge of workflow.edges ?? []) {
    const source = resolveEdgeEndpoint(
      edge.sourceActivityId,
      edge.sourceActivitySlug,
      activityIds
    );
    const target = resolveEdgeEndpoint(
      edge.targetActivityId,
      edge.targetActivitySlug,
      activityIds
    );
    if (source && target) {
      recordDesignedEdge(
        edges,
        source,
        target,
        edge.probability ?? 1,
        edge.kind
      );
    }
  }
}

function addDesignedMatrixEdges(
  workflow: DesignedWorkflowInput,
  activityIds: Map<string, string>,
  edges: Map<string, DesignedEdge>
) {
  for (let row = 0; row < (workflow.matrix?.length ?? 0); row += 1) {
    addDesignedMatrixRow(workflow, activityIds, edges, row);
  }
}

function addDesignedMatrixRow(
  workflow: DesignedWorkflowInput,
  activityIds: Map<string, string>,
  edges: Map<string, DesignedEdge>,
  row: number
) {
  const sourceActivity = workflow.activities[row];
  const source = sourceActivity
    ? activityIds.get(sourceActivity.slug)
    : undefined;
  const matrixRow = workflow.matrix?.[row] ?? [];
  if (!source) {
    return;
  }
  for (let column = 0; column < matrixRow.length; column += 1) {
    const probability = matrixRow[column] ?? 0;
    const targetActivity = workflow.activities[column];
    const target = targetActivity
      ? activityIds.get(targetActivity.slug)
      : undefined;
    if (target && probability > 0) {
      recordDesignedEdge(edges, source, target, probability, "sequence");
    }
  }
}

function resolveEdgeEndpoint(
  activityId: string | undefined,
  activitySlug: string | undefined,
  activityIds: Map<string, string>
): string | undefined {
  return (
    activityId ?? (activitySlug ? activityIds.get(activitySlug) : undefined)
  );
}

function recordDesignedEdge(
  edges: Map<string, DesignedEdge>,
  source: string,
  target: string,
  probability: number,
  kind: EdgeKind = "sequence"
) {
  edges.set(edgeId(source, target), {
    kind,
    probability,
    source,
    target,
  });
}

function canonicalizeStep(
  step: MiningStepInput,
  sessions: Map<string, SessionContext>,
  designed: DesignedOverlay
): CanonicalStep | null {
  const session = sessions.get(step.sessionId) ?? {
    id: step.sessionId,
    projectId: step.projectId ?? null,
    workflowId: step.workflowId ?? null,
  };
  const designedActivity =
    designed.activitiesBySlug.get(step.activitySlug) ??
    (step.activityId
      ? designed.activitiesById.get(step.activityId)
      : undefined);
  const activityId =
    designedActivity?.id ??
    step.activityId ??
    activityIdForSlug(step.activitySlug);

  return {
    activityId,
    activityLabel:
      step.activityLabel ??
      designedActivity?.label ??
      labelFromSlug(step.activitySlug),
    activitySlug: designedActivity?.slug ?? step.activitySlug,
    actorPersonId: step.actorPersonId ?? null,
    actorRole: step.actorRole ?? null,
    evidence: sortedEvidence(step.evidence ?? []),
    handoffToPersonId: step.handoffToPersonId ?? null,
    id: step.id,
    seq: step.seq,
    session: {
      id: session.id,
      projectId: step.projectId ?? session.projectId,
      workflowId: step.workflowId ?? session.workflowId,
    },
    tsEnd: step.tsEnd ?? null,
    tsStart: step.tsStart ?? null,
    type: step.type,
  };
}

function workflowMatchesScope(
  workflow: DesignedWorkflowInput,
  scope: MiningScope
): boolean {
  if (scope.workflowId && workflow.id !== scope.workflowId) {
    return false;
  }
  if (scope.projectId && workflow.projectId !== scope.projectId) {
    return false;
  }
  return true;
}

function contextMatchesScope(
  session: SessionContext,
  scope: MiningScope
): boolean {
  if (scope.workflowId && session.workflowId !== scope.workflowId) {
    return false;
  }
  if (scope.projectId && session.projectId !== scope.projectId) {
    return false;
  }
  return true;
}

function groupStepsBySession(
  steps: CanonicalStep[]
): Map<string, CanonicalStep[]> {
  const groups = new Map<string, CanonicalStep[]>();
  for (const step of steps) {
    const group = groups.get(step.session.id);
    if (group) {
      group.push(step);
    } else {
      groups.set(step.session.id, [step]);
    }
  }
  for (const group of groups.values()) {
    group.sort(compareCanonicalSteps);
  }
  return groups;
}

function compareCanonicalSteps(a: CanonicalStep, b: CanonicalStep): number {
  return (
    a.session.id.localeCompare(b.session.id) ||
    a.seq - b.seq ||
    (a.tsStart ?? "").localeCompare(b.tsStart ?? "") ||
    a.id.localeCompare(b.id)
  );
}

function newNodeAccumulator(
  id: string,
  slug: string,
  label: string
): NodeAccumulator {
  return {
    designed: false,
    designedRank: null,
    dwellSeconds: [],
    firstSeenTs: null,
    handoffCount: 0,
    id,
    label,
    occurrences: 0,
    policyIds: [],
    repeatedSessions: new Set<string>(),
    roleExpected: null,
    roles: new Map<string, number>(),
    slug,
    support: new Set<string>(),
  };
}

function edgeAccumulator(
  edges: Map<string, EdgeAccumulator>,
  source: string,
  target: string
): EdgeAccumulator {
  const id = edgeId(source, target);
  const existing = edges.get(id);
  if (existing) {
    return existing;
  }
  const created = {
    designed: false,
    designedProbability: null,
    evidence: [],
    kindCounts: new Map<EdgeKind, number>(),
    occurrences: 0,
    source,
    support: new Set<string>(),
    target,
  };
  edges.set(id, created);
  return created;
}

function classifyEdge(
  source: CanonicalStep,
  target: CanonicalStep,
  seenActivities: Set<string>
): EdgeKind {
  if (seenActivities.has(target.activityId)) {
    return "rework";
  }
  if (target.type === "approval") {
    return "approval";
  }
  if (source.type === "decision") {
    return "decision";
  }
  const actorsDiffer =
    source.actorPersonId !== null &&
    target.actorPersonId !== null &&
    source.actorPersonId !== target.actorPersonId;
  const explicitHandoff =
    source.handoffToPersonId !== null &&
    source.handoffToPersonId === target.actorPersonId;
  if (actorsDiffer || explicitHandoff) {
    return "handoff";
  }
  return "sequence";
}

function toAggregateNode(node: NodeAccumulator): AggregateNode {
  const support = node.support.size;
  return {
    avgDwellSeconds:
      node.dwellSeconds.length > 0 ? average(node.dwellSeconds) : null,
    designed: node.designed,
    designedRank: node.designedRank,
    firstSeenTs: node.firstSeenTs,
    handoffCount: node.handoffCount,
    id: node.id,
    label: node.label,
    occurrences: node.occurrences,
    plane: planeFor(node.designed, node.occurrences > 0),
    policyIds: [...node.policyIds].sort(),
    reworkRate: support > 0 ? node.repeatedSessions.size / support : 0,
    roleExpected: node.roleExpected,
    roles: [...node.roles.entries()]
      .map(([role, count]) => ({ count, role }))
      .sort((a, b) => b.count - a.count || a.role.localeCompare(b.role)),
    slug: node.slug,
    support,
  };
}

function toAggregateEdge(edge: EdgeAccumulator): AggregateEdge {
  const hasObserved = edge.occurrences > 0;
  return {
    cases: [...edge.support].sort(),
    designedProbability: edge.designedProbability,
    id: edgeId(edge.source, edge.target),
    isBackEdge: false,
    kind: dominantKind(edge.kindCounts),
    occurrences: edge.occurrences,
    plane: planeFor(edge.designed, hasObserved),
    probability: 0,
    source: edge.source,
    support: edge.support.size,
    target: edge.target,
    transitions: edge.evidence,
  };
}

function dominantKind(kindCounts: Map<EdgeKind, number>): EdgeKind {
  let selected: EdgeKind = "sequence";
  let selectedCount = -1;
  for (const [kind, count] of kindCounts.entries()) {
    const priority = EDGE_KIND_PRIORITY.get(kind) ?? Number.MAX_SAFE_INTEGER;
    const selectedPriority =
      EDGE_KIND_PRIORITY.get(selected) ?? Number.MAX_SAFE_INTEGER;
    if (
      count > selectedCount ||
      (count === selectedCount && priority < selectedPriority)
    ) {
      selected = kind;
      selectedCount = count;
    }
  }
  return selected;
}

function markBackEdges(edges: AggregateEdge[]): AggregateEdge[] {
  const withProbabilities = assignObservedProbabilities(edges);
  const bySource = new Map<string, AggregateEdge[]>();
  for (const edge of withProbabilities) {
    bySource.set(edge.source, [...(bySource.get(edge.source) ?? []), edge]);
  }
  for (const sourceEdges of bySource.values()) {
    sourceEdges.sort(compareAggregateEdges);
  }

  const visited = new Set<string>();
  const visiting = new Set<string>();
  const backEdges = new Set<string>();
  const nodes = [
    ...new Set(withProbabilities.flatMap((edge) => [edge.source, edge.target])),
  ].sort();

  const visit = (nodeId: string) => {
    visiting.add(nodeId);
    for (const edge of bySource.get(nodeId) ?? []) {
      if (edge.kind === "rework") {
        backEdges.add(edge.id);
        continue;
      }
      if (visiting.has(edge.target)) {
        backEdges.add(edge.id);
        continue;
      }
      if (!visited.has(edge.target)) {
        visit(edge.target);
      }
    }
    visiting.delete(nodeId);
    visited.add(nodeId);
  };

  for (const node of nodes) {
    if (!visited.has(node)) {
      visit(node);
    }
  }

  return withProbabilities.map((edge) => ({
    ...edge,
    isBackEdge: backEdges.has(edge.id),
  }));
}

function assignObservedProbabilities(edges: AggregateEdge[]): AggregateEdge[] {
  const outgoingOccurrences = new Map<string, number>();
  for (const edge of edges) {
    if (edge.occurrences > 0) {
      outgoingOccurrences.set(
        edge.source,
        (outgoingOccurrences.get(edge.source) ?? 0) + edge.occurrences
      );
    }
  }
  return edges.map((edge) => ({
    ...edge,
    probability:
      edge.occurrences > 0
        ? edge.occurrences / (outgoingOccurrences.get(edge.source) ?? 1)
        : (edge.designedProbability ?? 0),
  }));
}

function buildInstanceGraph(
  steps: CanonicalStep[],
  aggregateNodes: AggregateNode[],
  stepsBySession: Map<string, CanonicalStep[]>
): InstanceGraph {
  const planes = new Map(aggregateNodes.map((node) => [node.id, node.plane]));
  const nodes = steps.map((step) => ({
    accepted: true as const,
    activityId: step.activityId,
    activitySlug: step.activitySlug,
    actorPersonId: step.actorPersonId,
    actorRole: step.actorRole,
    id: step.id,
    plane: planes.get(step.activityId) ?? "discovered",
    seq: step.seq,
    sessionId: step.session.id,
    type: step.type,
  }));
  const edges: InstanceEdge[] = [];
  for (const sessionSteps of stepsBySession.values()) {
    const seenActivities = new Set<string>();
    for (let index = 0; index < sessionSteps.length - 1; index += 1) {
      const source = sessionSteps[index];
      const target = sessionSteps[index + 1];
      if (!(source && target)) {
        continue;
      }
      const kind = classifyEdge(source, target, seenActivities);
      seenActivities.add(source.activityId);
      edges.push({
        fromStepId: source.id,
        id: edgeId(source.id, target.id),
        kind,
        sessionId: source.session.id,
        toStepId: target.id,
      });
    }
  }
  return {
    edges,
    nodes,
  };
}

function buildVariants(
  stepsBySession: Map<string, CanonicalStep[]>
): VariantSummary[] {
  const variants = new Map<string, VariantSummary>();
  for (const [sessionId, steps] of stepsBySession.entries()) {
    const path = steps.map((step) => step.activitySlug);
    const signature = path.join(" -> ");
    const variant = variants.get(signature) ?? {
      count: 0,
      path,
      sessionIds: [],
      signature,
    };
    variant.count += 1;
    variant.sessionIds.push(sessionId);
    variants.set(signature, variant);
  }
  return [...variants.values()]
    .map((variant) => ({
      ...variant,
      sessionIds: [...variant.sessionIds].sort(),
    }))
    .sort(
      (a, b) => b.count - a.count || a.signature.localeCompare(b.signature)
    );
}

function buildHappyPath(
  nodes: AggregateNode[],
  edges: AggregateEdge[],
  entryActivityId: string | null,
  exitActivityIds: string[]
): HappyPathStep[] {
  const nodeById = new Map(nodes.map((node) => [node.id, node]));
  const dagEdges = edges.filter(
    (edge) => edge.kind !== "rework" && !edge.isBackEdge
  );
  const incoming = new Set(dagEdges.map((edge) => edge.target));
  const starts = nodes
    .filter((node) => node.support > 0 || node.designed)
    .filter((node) => node.id === entryActivityId || !incoming.has(node.id))
    .sort(compareAggregateNodes);
  const first = entryActivityId
    ? (nodeById.get(entryActivityId) ?? starts[0])
    : starts[0];
  if (!first) {
    return [];
  }
  const exits = new Set(exitActivityIds);
  const bySource = new Map<string, AggregateEdge[]>();
  for (const edge of dagEdges) {
    bySource.set(edge.source, [...(bySource.get(edge.source) ?? []), edge]);
  }
  for (const sourceEdges of bySource.values()) {
    sourceEdges.sort((a, b) => {
      const aTarget = nodeById.get(a.target);
      const bTarget = nodeById.get(b.target);
      return (
        b.support - a.support ||
        b.occurrences - a.occurrences ||
        planeScore(b.plane) - planeScore(a.plane) ||
        (b.designedProbability ?? 0) - (a.designedProbability ?? 0) ||
        (bTarget?.support ?? 0) - (aTarget?.support ?? 0) ||
        b.probability - a.probability ||
        a.target.localeCompare(b.target)
      );
    });
  }

  const path: HappyPathStep[] = [];
  const seen = new Set<string>();
  let current: AggregateNode | undefined = first;
  while (current && !seen.has(current.id)) {
    path.push({ activityId: current.id, slug: current.slug });
    seen.add(current.id);
    if (exits.has(current.id)) {
      break;
    }
    const nextEdge: AggregateEdge | undefined = (
      bySource.get(current.id) ?? []
    ).find((edge) => !seen.has(edge.target));
    current = nextEdge ? nodeById.get(nextEdge.target) : undefined;
  }
  return path;
}

function buildStats(
  nodes: AggregateNode[],
  edges: AggregateEdge[],
  sessions: number,
  acceptedSteps: number,
  variants: number
): GraphStats {
  return {
    acceptedSteps,
    designedActivities: nodes.filter((node) => node.designed).length,
    discoveredActivities: nodes.filter((node) => node.occurrences > 0).length,
    handoffs: edges
      .filter((edge) => edge.kind === "handoff")
      .reduce((sum, edge) => sum + edge.occurrences, 0),
    sessions,
    variants,
  };
}

function diffById<TNode extends { id: string }, TEdge extends { id: string }>(
  fromRevision: string,
  toRevision: string,
  previousNodes: TNode[],
  currentNodes: TNode[],
  previousEdges: TEdge[],
  currentEdges: TEdge[]
): GraphDiff<TNode, TEdge> {
  return {
    added: {
      edges: addedItems(previousEdges, currentEdges),
      nodes: addedItems(previousNodes, currentNodes),
    },
    fromRevision,
    removed: {
      edges: removedItems(previousEdges, currentEdges),
      nodes: removedItems(previousNodes, currentNodes),
    },
    toRevision,
    updated: {
      edges: updatedItems(previousEdges, currentEdges),
      nodes: updatedItems(previousNodes, currentNodes),
    },
  };
}

function addedItems<T extends { id: string }>(
  previous: T[],
  current: T[]
): T[] {
  const previousIds = new Set(previous.map((item) => item.id));
  return current.filter((item) => !previousIds.has(item.id));
}

function removedItems<T extends { id: string }>(
  previous: T[],
  current: T[]
): T[] {
  const currentIds = new Set(current.map((item) => item.id));
  return previous.filter((item) => !currentIds.has(item.id));
}

function updatedItems<T extends { id: string }>(
  previous: T[],
  current: T[]
): T[] {
  const previousById = new Map(previous.map((item) => [item.id, item]));
  return current.filter((item) => {
    const oldItem = previousById.get(item.id);
    return (
      oldItem !== undefined &&
      stableStringify(oldItem) !== stableStringify(item)
    );
  });
}

function compareAggregateNodes(a: AggregateNode, b: AggregateNode): number {
  return (
    (a.designedRank ?? Number.MAX_SAFE_INTEGER) -
      (b.designedRank ?? Number.MAX_SAFE_INTEGER) ||
    a.slug.localeCompare(b.slug) ||
    a.id.localeCompare(b.id)
  );
}

function compareAggregateEdges(a: AggregateEdge, b: AggregateEdge): number {
  return (
    a.source.localeCompare(b.source) ||
    a.target.localeCompare(b.target) ||
    a.id.localeCompare(b.id)
  );
}

function edgeId(source: string, target: string): string {
  return `${source}::${target}`;
}

function activityIdForSlug(slug: string): string {
  return `act_${slug}`;
}

function labelFromSlug(slug: string): string {
  return slug
    .split("_")
    .map((word) => `${word.charAt(0).toUpperCase()}${word.slice(1)}`)
    .join(" ");
}

function earliestTimestamp(
  current: string | null,
  candidate: string | null
): string | null {
  if (candidate === null) {
    return current;
  }
  if (current === null || candidate.localeCompare(current) < 0) {
    return candidate;
  }
  return current;
}

function dwellSeconds(
  step: CanonicalStep,
  cache: Map<string, number | null>
): number | null {
  if (!(step.tsStart && step.tsEnd)) {
    return null;
  }
  const cacheKey = `${step.tsStart}/${step.tsEnd}`;
  if (cache.has(cacheKey)) {
    return cache.get(cacheKey) ?? null;
  }
  const start = Date.parse(step.tsStart);
  const end = Date.parse(step.tsEnd);
  if (!(Number.isFinite(start) && Number.isFinite(end) && end >= start)) {
    cache.set(cacheKey, null);
    return null;
  }
  const dwell = (end - start) / 1000;
  cache.set(cacheKey, dwell);
  return dwell;
}

function average(values: number[]): number {
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function planeFor(designed: boolean, observed: boolean): ActivityPlane {
  if (designed && observed) {
    return "both";
  }
  if (designed) {
    return "designed";
  }
  return "discovered";
}

function sortedEvidence(evidence: string[]): string[] {
  if (evidence.length < 2) {
    return [...evidence];
  }
  return [...evidence].sort();
}

function revisionInputForGraph(
  graph: Omit<AggregateGraph, "revision">
): unknown {
  return {
    edges: graph.edges.map((edge) => ({
      cases: edge.cases,
      designedProbability: edge.designedProbability,
      id: edge.id,
      isBackEdge: edge.isBackEdge,
      kind: edge.kind,
      occurrences: edge.occurrences,
      plane: edge.plane,
      probability: edge.probability,
      source: edge.source,
      support: edge.support,
      target: edge.target,
      transitionCount: edge.transitions.length,
    })),
    nodes: graph.nodes,
    scope: graph.scope,
    stats: graph.stats,
    variants: graph.variants.map((variant) => ({
      count: variant.count,
      sessionIds: variant.sessionIds,
      signature: variant.signature,
    })),
  };
}

function planeScore(plane: ActivityPlane): number {
  if (plane === "both") {
    return 2;
  }
  if (plane === "designed") {
    return 1;
  }
  return 0;
}

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableStringify(item)).join(",")}]`;
  }
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${stableStringify(record[key])}`)
    .join(",")}}`;
}

function makeRevision(value: unknown): string {
  let hash = 5381;
  for (const char of stableStringify(value)) {
    hash = (Math.imul(hash, 33) + char.charCodeAt(0)) % 4_294_967_296;
    if (hash < 0) {
      hash += 4_294_967_296;
    }
  }
  return `rev_${hash.toString(16).padStart(8, "0")}`;
}
