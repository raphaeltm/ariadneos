export const workflows = [
  {
    description: "From a new vendor request to a signed agreement.",
    icon: "briefcase",
    id: "vendor",
    name: "Vendor onboarding",
    prefix: "VEN",
  },
  {
    description: "Follow a customer request through review and resolution.",
    icon: "refund",
    id: "refund",
    name: "Customer refunds",
    prefix: "REF",
  },
  {
    description: "Understand how teammates get the tools they need.",
    icon: "key",
    id: "access",
    name: "Access requests",
    prefix: "ACC",
  },
] as const;
export type WorkflowId = (typeof workflows)[number]["id"];
export const DEFAULT_EVENT_CONFIDENCE = 1;
export const DEFAULT_WORKSPACE = "demo";
export type ActivityGroundingState =
  | "confirmed"
  | "grounded"
  | "inferred"
  | "proposed"
  | "rejected";
export type ActivityLifecycleState =
  | "abandoned"
  | "committed"
  | "done"
  | "requested"
  | "skipped";
export type ActivityModality =
  | "committed"
  | "negated"
  | "reported"
  | "requested";
export type ActivityCurationStatus = "confirmed" | "proposed" | "rejected";
export type GraphPlane = "both" | "designed" | "discovered";
export interface MessageRef {
  author: string;
  authorId: string;
  channel: string;
  permalink: string;
  text: string;
  ts: string;
  workspace?: string;
}
export interface ActivityEvent {
  action: string;
  actor: string;
  artifact: string;
  caseId: string;
  confidence?: number;
  id: string;
  messages?: MessageRef[];
  modality?: ActivityModality;
  role: string;
  sequence: number;
  source: "simulation" | "slack";
  state?: ActivityLifecycleState;
  status?: ActivityCurationStatus;
  timestamp: string;
  workflow: WorkflowId;
  workspace?: string;
}
export interface Policy {
  after?: string;
  before?: string;
  id: string;
  kind: "approval" | "mandatory" | "ordering" | "threshold";
  roles?: string[];
  text: string;
  workflow: WorkflowId;
}
export interface DesignedModel {
  activities: {
    label: string;
    role: string;
    slug: string;
    synonyms?: string[];
  }[];
  entry: string;
  matrix: number[][];
  policies: Policy[];
  workflow: WorkflowId;
}
export interface Conformance {
  extra: { count: number; slug: string }[];
  fitness: number;
  grounded: number;
  missing: { of: number; seenIn: number; slug: string }[];
  orderBreaks: { expectedBetween: string; from: string; to: string }[];
  precision: number;
  roleDeviations: { expected: string; observed: string[]; slug: string }[];
  violations: {
    caseIds: string[];
    evidence: MessageRef[];
    policyId: string;
    quote?: string;
  }[];
}
export type GraphEditAction =
  | "add_edge"
  | "add_node"
  | "confirm"
  | "merge"
  | "promote"
  | "reject"
  | "remove_edge"
  | "remove_node"
  | "rename"
  | "require"
  | "retire";
export interface GraphEdit {
  action: GraphEditAction;
  actor: string;
  createdAt: string;
  id: string;
  payload: Record<string, string>;
  undone?: boolean;
  workflow: WorkflowId;
}
export interface ProcessEdge {
  cases: number;
  count: number;
  evidence: { from: string; to: string; caseId: string }[];
  id: string;
  isBackEdge?: boolean;
  medianMinutes: number;
  plane?: GraphPlane;
  probability: number;
  source: string;
  target: string;
  violates?: string[];
}
export interface ProcessNode {
  actors: string[];
  count: number;
  grounded?: number;
  id: string;
  label: string;
  plane?: GraphPlane;
  role: string;
  roleExpected?: string;
  terminal: boolean;
}
export interface CaseTrace {
  artifact: string;
  durationMinutes: number;
  events: ActivityEvent[];
  id: string;
  variant: string;
}
export type ProcessModel = ReturnType<typeof mine>;
export interface Snapshot {
  canRedo?: boolean;
  canUndo?: boolean;
  conformance?: Conformance;
  edits?: GraphEdit[];
  events: ActivityEvent[];
  generatedAt: string;
  model: ProcessModel & { revision?: string };
  remainingRuns: number;
  revision?: string;
  source: "simulation";
  workflow: (typeof workflows)[number];
}
export interface AgentEvent {
  caseId?: string;
  citations: MessageRef[];
  createdAt: string;
  id: string;
  kind: "answer" | "drift" | "playbook";
  nodes: string[];
  pauses: boolean;
  policyId?: string;
  resolution?: "approve" | "hold" | "reject";
  text: string;
  workflow: WorkflowId;
}
export interface PipelineEvent {
  activity?: string;
  caseId?: string;
  confidence?: number;
  createdAt: string;
  id: string;
  kind: "agent" | "canon" | "extract" | "graph" | "ground" | "message";
  message?: MessageRef;
  messages?: MessageRef[];
  nodes?: string[];
  text: string;
  workflow: WorkflowId;
  workspace?: string;
}
export interface WorkspaceDto {
  channel: string;
  id: string;
  name: string;
  workflows: WorkflowId[];
}
export interface WorkflowLink {
  artifact: string;
  cases: { source: string; target: string }[];
  count: number;
  source: WorkflowId;
  target: WorkflowId;
}
export function activityConfidence(event: ActivityEvent) {
  return event.confidence ?? DEFAULT_EVENT_CONFIDENCE;
}
export function activityGrounding(
  event: ActivityEvent
): ActivityGroundingState {
  if (event.status === "rejected") {
    return "rejected";
  }
  if (event.status === "proposed" || activityConfidence(event) < 0.4) {
    return "proposed";
  }
  if (event.status === "confirmed") {
    return "confirmed";
  }
  if (event.messages?.some((message) => message.permalink)) {
    return "grounded";
  }
  return "inferred";
}
export function activityWorkspace(event: ActivityEvent) {
  return event.workspace ?? DEFAULT_WORKSPACE;
}
export function designedEdgesFrom(designed: DesignedModel): ProcessEdge[] {
  const edges: ProcessEdge[] = [];
  designed.matrix.forEach((row, rowIndex) => {
    const source = designed.activities[rowIndex];
    if (!source) {
      return;
    }
    row.forEach((weight, columnIndex) => {
      const target = designed.activities[columnIndex];
      if (!(target && weight > 0)) {
        return;
      }
      edges.push({
        cases: 0,
        count: 0,
        evidence: [],
        id: `${source.slug}::${target.slug}`,
        medianMinutes: 0,
        plane: "designed",
        probability: weight,
        source: source.slug,
        target: target.slug,
      });
    });
  });
  return edges;
}
export function isAggregateEligible(event: ActivityEvent) {
  const grounding = activityGrounding(event);
  return grounding !== "proposed" && grounding !== "rejected";
}
export function isWorkflow(value: string): value is WorkflowId {
  return workflows.some((w) => w.id === value);
}
export function median(values: number[]) {
  const s = [...values].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  const middle = s[m];
  if (middle === undefined) {
    return 0;
  }
  if (s.length % 2) {
    return middle;
  }
  return ((s[m - 1] ?? middle) + middle) / 2;
}
export function mine(input: ActivityEvent[], designed?: DesignedModel) {
  const unique = [...new Map(input.map((e) => [e.id, e])).values()];
  const groups = new Map<string, ActivityEvent[]>();
  for (const e of unique) {
    const key = `${e.workflow}:${e.caseId}`;
    groups.set(key, [...(groups.get(key) ?? []), e]);
  }
  const nodes = new Map<string, ProcessNode>();
  const links = new Map<
    string,
    {
      source: string;
      target: string;
      times: number[];
      evidence: ProcessEdge["evidence"];
    }
  >();
  const variants = new Map<
    string,
    { path: string[]; count: number; caseIds: string[] }
  >();
  const traces: CaseTrace[] = [];
  let handoffs = 0;
  for (const events of groups.values()) {
    events.sort(
      (a, b) =>
        a.timestamp.localeCompare(b.timestamp) ||
        a.sequence - b.sequence ||
        a.id.localeCompare(b.id)
    );
    const [first] = events;
    const last = events.at(-1);
    if (!(first && last)) {
      continue;
    }
    const path = events.map((e) => e.action);
    const signature = path.join(" → ");
    const variant = variants.get(signature) ?? { caseIds: [], count: 0, path };
    variant.count += 1;
    variant.caseIds.push(first.caseId);
    variants.set(signature, variant);
    traces.push({
      artifact: first.artifact,
      durationMinutes:
        (Date.parse(last.timestamp) - Date.parse(first.timestamp)) / 60_000,
      events,
      id: first.caseId,
      variant: signature,
    });
    events.forEach((e, i) => {
      const node = nodes.get(e.action) ?? {
        actors: [],
        count: 0,
        id: e.action,
        label: e.action,
        role: e.role,
        terminal: true,
      };
      node.count += 1;
      if (!node.actors.includes(e.actor)) {
        node.actors.push(e.actor);
      }
      if (i < events.length - 1) {
        node.terminal = false;
      }
      nodes.set(e.action, node);
      const next = events[i + 1];
      if (!next) {
        return;
      }
      if (next.actor !== e.actor) {
        handoffs += 1;
      }
      const id = `${e.action}::${next.action}`;
      const link = links.get(id) ?? {
        evidence: [],
        source: e.action,
        target: next.action,
        times: [],
      };
      link.times.push(
        (Date.parse(next.timestamp) - Date.parse(e.timestamp)) / 60_000
      );
      link.evidence.push({ caseId: e.caseId, from: e.id, to: next.id });
      links.set(id, link);
    });
  }
  const outgoing = new Map<string, number>();
  for (const link of links.values()) {
    outgoing.set(
      link.source,
      (outgoing.get(link.source) ?? 0) + link.times.length
    );
  }
  const edges: ProcessEdge[] = [...links.entries()].map(([id, l]) => ({
    cases: new Set(l.evidence.map((e) => e.caseId)).size,
    count: l.times.length,
    evidence: l.evidence,
    id,
    medianMinutes: median(l.times),
    probability: l.times.length / (outgoing.get(l.source) ?? 1),
    source: l.source,
    target: l.target,
  }));
  const rankedVariants = [...variants.values()].sort(
    (a, b) => b.count - a.count || a.path.join().localeCompare(b.path.join())
  );
  return {
    ...(designed ? { designedEdges: designedEdgesFrom(designed) } : {}),
    edges,
    nodes: [...nodes.values()],
    stats: {
      cases: traces.length,
      dominantShare: traces.length
        ? (rankedVariants[0]?.count ?? 0) / traces.length
        : 0,
      events: unique.length,
      handoffs,
      medianMinutes: median(traces.map((t) => t.durationMinutes)),
      variants: variants.size,
    },
    traces: traces.sort((a, b) =>
      (b.events[0]?.timestamp ?? "").localeCompare(a.events[0]?.timestamp ?? "")
    ),
    variants: rankedVariants,
  };
}
export function duration(minutes: number) {
  return minutes < 60
    ? `${Math.round(minutes)}m`
    : `${(minutes / 60).toFixed(1)}h`;
}
