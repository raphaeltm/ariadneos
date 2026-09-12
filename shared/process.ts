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
export interface ActivityEvent {
  action: string;
  actor: string;
  artifact: string;
  caseId: string;
  id: string;
  role: string;
  sequence: number;
  source: "simulation";
  timestamp: string;
  workflow: WorkflowId;
}
export interface ProcessEdge {
  cases: number;
  count: number;
  evidence: { from: string; to: string; caseId: string }[];
  id: string;
  medianMinutes: number;
  probability: number;
  source: string;
  target: string;
}
export interface ProcessNode {
  actors: string[];
  count: number;
  id: string;
  label: string;
  role: string;
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
  events: ActivityEvent[];
  generatedAt: string;
  model: ProcessModel;
  remainingRuns: number;
  source: "simulation";
  workflow: (typeof workflows)[number];
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
export function mine(input: ActivityEvent[]) {
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
