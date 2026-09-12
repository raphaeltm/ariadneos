export const workflows = [
  {
    id: "vendor",
    name: "Vendor onboarding",
    description: "From a new vendor request to a signed agreement.",
    prefix: "VEN",
    icon: "briefcase",
  },
  {
    id: "refund",
    name: "Customer refunds",
    description: "Follow a customer request through review and resolution.",
    prefix: "REF",
    icon: "refund",
  },
  {
    id: "access",
    name: "Access requests",
    description: "Understand how teammates get the tools they need.",
    prefix: "ACC",
    icon: "key",
  },
] as const;
export type WorkflowId = (typeof workflows)[number]["id"];
export type ActivityEvent = {
  id: string;
  caseId: string;
  workflow: WorkflowId;
  actor: string;
  role: string;
  action: string;
  artifact: string;
  timestamp: string;
  source: "simulation";
  sequence: number;
};
export type ProcessEdge = {
  id: string;
  source: string;
  target: string;
  count: number;
  cases: number;
  probability: number;
  medianMinutes: number;
  evidence: { from: string; to: string; caseId: string }[];
};
export type ProcessNode = {
  id: string;
  label: string;
  count: number;
  actors: string[];
  role: string;
  terminal: boolean;
};
export type CaseTrace = {
  id: string;
  artifact: string;
  events: ActivityEvent[];
  durationMinutes: number;
  variant: string;
};
export type ProcessModel = ReturnType<typeof mine>;
export type Snapshot = {
  workflow: (typeof workflows)[number];
  model: ProcessModel;
  events: ActivityEvent[];
  remainingRuns: number;
  source: "simulation";
  generatedAt: string;
};
export function isWorkflow(value: string): value is WorkflowId {
  return workflows.some((w) => w.id === value);
}
export function median(values: number[]) {
  const s = [...values].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length ? (s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2) : 0;
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
        a.id.localeCompare(b.id),
    );
    const path = events.map((e) => e.action);
    const signature = path.join(" → ");
    const variant = variants.get(signature) ?? { path, count: 0, caseIds: [] };
    variant.count++;
    variant.caseIds.push(events[0].caseId);
    variants.set(signature, variant);
    traces.push({
      id: events[0].caseId,
      artifact: events[0].artifact,
      events,
      durationMinutes:
        (Date.parse(events.at(-1)!.timestamp) -
          Date.parse(events[0].timestamp)) /
        60000,
      variant: signature,
    });
    events.forEach((e, i) => {
      const node = nodes.get(e.action) ?? {
        id: e.action,
        label: e.action,
        count: 0,
        actors: [],
        role: e.role,
        terminal: true,
      };
      node.count++;
      if (!node.actors.includes(e.actor)) node.actors.push(e.actor);
      if (i < events.length - 1) node.terminal = false;
      nodes.set(e.action, node);
      const next = events[i + 1];
      if (!next) return;
      if (next.actor !== e.actor) handoffs++;
      const id = `${e.action}::${next.action}`;
      const link = links.get(id) ?? {
        source: e.action,
        target: next.action,
        times: [],
        evidence: [],
      };
      link.times.push(
        (Date.parse(next.timestamp) - Date.parse(e.timestamp)) / 60000,
      );
      link.evidence.push({ from: e.id, to: next.id, caseId: e.caseId });
      links.set(id, link);
    });
  }
  const outgoing = new Map<string, number>();
  for (const link of links.values())
    outgoing.set(
      link.source,
      (outgoing.get(link.source) ?? 0) + link.times.length,
    );
  const edges: ProcessEdge[] = [...links.entries()].map(([id, l]) => ({
    id,
    source: l.source,
    target: l.target,
    count: l.times.length,
    cases: new Set(l.evidence.map((e) => e.caseId)).size,
    probability: l.times.length / (outgoing.get(l.source) ?? 1),
    medianMinutes: median(l.times),
    evidence: l.evidence,
  }));
  const rankedVariants = [...variants.values()].sort(
    (a, b) => b.count - a.count || a.path.join().localeCompare(b.path.join()),
  );
  return {
    nodes: [...nodes.values()],
    edges,
    traces: traces.sort((a, b) =>
      b.events[0].timestamp.localeCompare(a.events[0].timestamp),
    ),
    variants: rankedVariants,
    stats: {
      cases: traces.length,
      events: unique.length,
      variants: variants.size,
      handoffs,
      medianMinutes: median(traces.map((t) => t.durationMinutes)),
      dominantShare: traces.length
        ? (rankedVariants[0]?.count ?? 0) / traces.length
        : 0,
    },
  };
}
export function duration(minutes: number) {
  return minutes < 60
    ? `${Math.round(minutes)}m`
    : `${(minutes / 60).toFixed(1)}h`;
}
