import type { KnowledgeBase } from "../../../shared/contracts.ts";
import type {
  ActivityEvent,
  ProcessEdge,
  ProcessModel,
  ProcessNode,
} from "../../../shared/process.ts";
import type {
  ActivityId,
  GraphEdge,
  GraphNode,
  GraphView,
  Message,
  MessageId,
  ProcessSession,
  SessionConformance,
  Step,
  StepId,
  WorkflowConformance,
} from "../../api.ts";
import type { AppSelection } from "../../store.ts";

export interface InspectorEvidence {
  author: string;
  caseId: string;
  id: string;
  permalink?: string;
  quote: string;
  timestamp: string;
}

export interface InspectorCurationItem {
  confidence?: number;
  id: StepId | string;
  label: string;
  reason: string;
  status: "confirmed" | "proposed" | "rejected";
}

export interface InspectorConformanceSection {
  items: string[];
  title: string;
  tone?: "danger" | "neutral" | "warning";
}

export interface InspectorMetric {
  label: string;
  value: string;
}

export interface InspectorDetails {
  badges: string[];
  conformanceSections: InspectorConformanceSection[];
  curationItems: InspectorCurationItem[];
  evidence: InspectorEvidence[];
  metrics: InspectorMetric[];
  overviewPath: string[];
  summary: string;
  title: string;
  type: "edge" | "message" | "node" | "overview";
}

interface ContractInspectorInput {
  conformance?: Array<SessionConformance | WorkflowConformance>;
  graph: GraphView | null;
  kb: KnowledgeBase | null;
  messages: Record<MessageId, Message>;
  selection: AppSelection;
  sessions: Record<string, ProcessSession>;
  steps: Record<StepId, Step>;
}

export function buildContractInspectorDetails({
  conformance = [],
  graph,
  kb,
  messages,
  selection,
  sessions,
  steps,
}: ContractInspectorInput): InspectorDetails {
  if (!graph) {
    return emptyDetails("No graph selected yet.");
  }
  const nodesById = new Map<string, GraphNode>(
    graph.nodes.map((node) => [node.id, node])
  );
  const edgesById = new Map<string, GraphEdge>(
    graph.edges.map((edge) => [edge.id, edge])
  );
  const selectedNode = selection.node_id
    ? nodesById.get(selection.node_id)
    : undefined;
  const selectedEdge = selection.edge_id
    ? edgesById.get(selection.edge_id)
    : undefined;
  const selectedMessage = selection.message_id
    ? messages[selection.message_id]
    : undefined;
  const stepsBySession = groupStepsBySession(Object.values(steps));
  const selectedSteps = contractSelectedSteps(
    selectedNode,
    selectedEdge,
    selectedMessage,
    stepsBySession,
    Object.values(steps)
  );
  const relevantConformance = relevantConformanceRecords(
    conformance,
    graph.conformance,
    selectedEdge,
    selectedNode,
    sessions
  );

  if (selectedNode) {
    const grounding = groundingMetric(selectedSteps);
    return {
      badges: [
        planeLabel(selectedNode.activity.plane),
        `support ${selectedNode.activity.support}`,
        selectedNode.activity.role_expected ?? "role unknown",
      ],
      conformanceSections: contractConformanceSections(
        relevantConformance,
        selectedNode,
        selectedEdge,
        graph,
        kb
      ),
      curationItems: curationItemsForSteps(selectedSteps),
      evidence: evidenceForSteps(selectedSteps, messages),
      metrics: [
        { label: "Observed", value: String(selectedNode.activity.occurrences) },
        { label: "Grounded", value: grounding },
        { label: "Cases", value: String(selectedCaseCount(selectedSteps)) },
      ],
      overviewPath: [],
      summary: `${selectedNode.activity.label} is ${planeLabel(
        selectedNode.activity.plane
      ).toLowerCase()} with ${selectedNode.activity.support} supporting observations.`,
      title: selectedNode.activity.label,
      type: "node",
    };
  }

  if (selectedEdge) {
    return {
      badges: [
        edgeKindLabel(selectedEdge.kind),
        planeLabel(selectedEdge.plane),
        selectedEdge.violates.length
          ? `${selectedEdge.violates.length} policy issue`
          : "no policy issue",
        `${selectedEdge.weight} support`,
      ],
      conformanceSections: contractConformanceSections(
        relevantConformance,
        selectedNode,
        selectedEdge,
        graph,
        kb
      ),
      curationItems: curationItemsForSteps(selectedSteps),
      evidence: evidenceForSteps(selectedSteps, messages),
      metrics: [
        { label: "Cases", value: String(selectedEdge.cases.length) },
        { label: "Weight", value: String(selectedEdge.weight) },
        {
          label: "Probability",
          value:
            selectedEdge.probability === null
              ? "n/a"
              : percent(selectedEdge.probability),
        },
      ],
      overviewPath: [],
      summary: `${activityLabel(selectedEdge.from, nodesById)} to ${activityLabel(
        selectedEdge.to,
        nodesById
      )} appears in ${selectedEdge.cases.length} case${
        selectedEdge.cases.length === 1 ? "" : "s"
      }.`,
      title: `${activityLabel(selectedEdge.from, nodesById)} -> ${activityLabel(
        selectedEdge.to,
        nodesById
      )}`,
      type: "edge",
    };
  }

  if (selectedMessage) {
    const relatedSteps = selectedSteps;
    return {
      badges: ["source message", selectedMessage.availability],
      conformanceSections: [],
      curationItems: curationItemsForSteps(relatedSteps),
      evidence: [
        {
          author: selectedMessage.author_label,
          caseId: selectedMessage.session_id,
          id: selectedMessage.id,
          permalink: selectedMessage.permalink,
          quote: selectedMessage.text,
          timestamp: selectedMessage.received_at,
        },
      ],
      metrics: [
        { label: "Related steps", value: String(relatedSteps.length) },
        { label: "Revision", value: String(selectedMessage.revision) },
      ],
      overviewPath: [],
      summary: `${selectedMessage.author_label} provided evidence for ${relatedSteps.length} extracted observation${
        relatedSteps.length === 1 ? "" : "s"
      }.`,
      title: "Evidence message",
      type: "message",
    };
  }

  return {
    badges: [graph.kind, `min support ${graph.min_support}`],
    conformanceSections: workflowConformanceSections(
      graph.conformance,
      conformance
    ),
    curationItems: curationItemsForSteps(
      Object.values(steps).filter((step) => step.status === "proposed")
    ),
    evidence: [],
    metrics: [
      { label: "Activities", value: String(graph.nodes.length) },
      { label: "Edges", value: String(graph.edges.length) },
      {
        label: "Fitness",
        value:
          graph.conformance?.fitness === null ||
          graph.conformance?.fitness === undefined
            ? "n/a"
            : percent(graph.conformance.fitness),
      },
    ],
    overviewPath: graph.happy_path.map((edgeId) => edgeId),
    summary:
      "Select a step, edge, or source message to inspect evidence and conformance detail.",
    title: "Process at a glance",
    type: "overview",
  };
}

interface LegacyInspectorInput {
  events: ActivityEvent[];
  model: ProcessModel;
  selectedEdge: ProcessEdge | undefined;
  selectedNode: ProcessNode | undefined;
  selection: { id: string; kind: "edge" | "node" } | undefined;
}

export function buildLegacyInspectorDetails({
  events,
  model,
  selectedEdge,
  selectedNode,
  selection,
}: LegacyInspectorInput): InspectorDetails {
  if (!(selection && (selectedNode || selectedEdge))) {
    return {
      badges: [
        `${model.stats.variants} variants`,
        `${model.stats.cases} cases`,
      ],
      conformanceSections: [],
      curationItems: legacyCurationItems(events),
      evidence: [],
      metrics: [
        { label: "Events", value: String(model.stats.events) },
        { label: "Handoffs", value: String(model.stats.handoffs) },
        { label: "Main path", value: percent(model.stats.dominantShare) },
      ],
      overviewPath: model.variants[0]?.path ?? [],
      summary:
        "Select a step or transition to inspect its supporting observations.",
      title: "Process at a glance",
      type: "overview",
    };
  }

  if (selectedNode) {
    return {
      badges: [
        planeLabel(selectedNode.plane ?? "discovered"),
        selectedNode.roleExpected ?? selectedNode.role,
        `${selectedNode.count} observations`,
      ],
      conformanceSections: legacyNodeConformance(selectedNode),
      curationItems: legacyCurationItems(events),
      evidence: legacyEvidence(events),
      metrics: [
        { label: "Observed", value: String(selectedNode.count) },
        { label: "Actors", value: String(selectedNode.actors.length) },
        {
          label: "Grounded",
          value: `${selectedNode.grounded ?? groundedLegacyEvents(events)}/${events.length}`,
        },
      ],
      overviewPath: [],
      summary: `${selectedNode.label} is supported by ${selectedNode.count} observation${
        selectedNode.count === 1 ? "" : "s"
      } across ${selectedNode.actors.length} actor${
        selectedNode.actors.length === 1 ? "" : "s"
      }.`,
      title: selectedNode.label,
      type: "node",
    };
  }

  if (selectedEdge) {
    return {
      badges: [
        planeLabel(selectedEdge.plane ?? "discovered"),
        selectedEdge.violates?.length
          ? `${selectedEdge.violates.length} policy issue`
          : "no policy issue",
        `${selectedEdge.cases} cases`,
      ],
      conformanceSections: legacyEdgeConformance(selectedEdge),
      curationItems: legacyCurationItems(events),
      evidence: legacyEvidence(events),
      metrics: [
        { label: "Frequency", value: percent(selectedEdge.probability) },
        {
          label: "Median lag",
          value: `${Math.round(selectedEdge.medianMinutes)}m`,
        },
        { label: "Evidence", value: String(selectedEdge.evidence.length) },
      ],
      overviewPath: [],
      summary: `This transition appears ${selectedEdge.count} time${
        selectedEdge.count === 1 ? "" : "s"
      } in ${selectedEdge.cases} distinct case${
        selectedEdge.cases === 1 ? "" : "s"
      }.`,
      title: `${selectedEdge.source} -> ${selectedEdge.target}`,
      type: "edge",
    };
  }

  return emptyDetails("Selection is no longer available.");
}

function contractSelectedSteps(
  selectedNode: GraphNode | undefined,
  selectedEdge: GraphEdge | undefined,
  selectedMessage: Message | undefined,
  stepsBySession: Map<string, Step[]>,
  allSteps: Step[]
) {
  if (selectedNode) {
    return allSteps.filter(
      (step) =>
        step.id === selectedNode.id || step.activity_id === selectedNode.id
    );
  }
  if (selectedEdge) {
    const result: Step[] = [];
    for (const caseId of selectedEdge.cases) {
      const steps = stepsBySession.get(caseId) ?? [];
      for (let index = 0; index < steps.length - 1; index += 1) {
        const from = steps[index];
        const to = steps[index + 1];
        if (
          from &&
          to &&
          stepNodeId(from) === selectedEdge.from &&
          stepNodeId(to) === selectedEdge.to
        ) {
          result.push(from, to);
        }
      }
    }
    return uniqueBy(result, (step) => step.id);
  }
  if (selectedMessage) {
    return allSteps.filter((step) =>
      step.evidence.some((ref) => ref.message_id === selectedMessage.id)
    );
  }
  return [];
}

function contractConformanceSections(
  conformance: Array<SessionConformance | WorkflowConformance>,
  selectedNode: GraphNode | undefined,
  selectedEdge: GraphEdge | undefined,
  graph: GraphView,
  kb: KnowledgeBase | null
): InspectorConformanceSection[] {
  const sections: InspectorConformanceSection[] = [];
  const activityById = new Map(
    graph.nodes.map((node) => [node.id, node.activity])
  );
  const selectedSlug = selectedNode?.activity.slug;
  const fromSlug = selectedEdge
    ? activityById.get(selectedEdge.from)?.slug
    : undefined;
  const toSlug = selectedEdge
    ? activityById.get(selectedEdge.to)?.slug
    : undefined;

  const scoreRows = conformance
    .map((item) => {
      const name = "session_id" in item ? item.session_id : "workflow";
      return `${name}: fitness ${nullablePercent(item.fitness)}, precision ${nullablePercent(
        item.precision
      )}`;
    })
    .slice(0, 3);
  if (scoreRows.length) {
    sections.push({ items: scoreRows, title: "Scoring breakdown" });
  }

  const missing = conformance.flatMap((item) =>
    item.missing
      .filter((record) => !selectedSlug || record.slug === selectedSlug)
      .map(
        (record) =>
          `${record.slug} seen in ${record.seen_in_sessions}/${record.of} sessions`
      )
  );
  if (missing.length) {
    sections.push({
      items: uniqueStrings(missing),
      title: "Missing work",
      tone: "warning",
    });
  }

  const extra = conformance.flatMap((item) =>
    item.extra
      .filter((record) => !selectedSlug || record.slug === selectedSlug)
      .map((record) => `${record.slug} occurred ${record.occurrences} time(s)`)
  );
  if (extra.length) {
    sections.push({ items: uniqueStrings(extra), title: "Undocumented work" });
  }

  const orderBreaks = conformance.flatMap((item) =>
    item.order_breaks
      .filter(
        (record) =>
          !selectedEdge || (record.from === fromSlug && record.to === toSlug)
      )
      .map((record) =>
        record.expected_between
          ? `${record.from} -> ${record.to} skipped ${record.expected_between}`
          : `${record.from} -> ${record.to} is out of documented order`
      )
  );
  if (orderBreaks.length) {
    sections.push({
      items: uniqueStrings(orderBreaks),
      title: "Ordering",
      tone: "danger",
    });
  }

  const violations = conformance.flatMap((item) =>
    item.violations
      .filter(
        (violation) =>
          !selectedEdge || selectedEdge.violates.includes(violation.policy_id)
      )
      .map(
        (violation) =>
          `${policyLabel(violation.policy_id, kb)}: ${violation.quote || violation.text}`
      )
  );
  if (violations.length) {
    sections.push({
      items: uniqueStrings(violations),
      title: "Policy violations",
      tone: "danger",
    });
  }

  const roleDeviations = conformance.flatMap((item) =>
    item.role_deviations
      .filter(
        (record) =>
          !selectedNode || record.activity_id === selectedNode.activity.id
      )
      .map(
        (record) =>
          `${record.activity_id}: expected ${record.expected}, observed ${record.observed}`
      )
  );
  if (roleDeviations.length) {
    sections.push({
      items: uniqueStrings(roleDeviations),
      title: "Role deviations",
      tone: "warning",
    });
  }

  return sections;
}

function workflowConformanceSections(
  workflow: WorkflowConformance | null,
  records: Array<SessionConformance | WorkflowConformance>
) {
  const source = workflow ? [workflow] : records;
  if (!source.length) {
    return [];
  }
  return contractConformanceSections(
    source,
    undefined,
    undefined,
    {
      conformance: workflow,
      edges: [],
      generated_at: "",
      happy_path: [],
      key: "overview",
      kind: "overlay",
      min_support: 1,
      nodes: [],
      project_id: "proj_helios",
      revision: 0,
    },
    null
  );
}

function relevantConformanceRecords(
  records: Array<SessionConformance | WorkflowConformance>,
  workflowConformance: WorkflowConformance | null,
  selectedEdge: GraphEdge | undefined,
  selectedNode: GraphNode | undefined,
  sessions: Record<string, ProcessSession>
) {
  const relatedCaseIds = new Set(selectedEdge?.cases ?? []);
  for (const session of Object.values(sessions)) {
    if (selectedNode && session.missing.includes(selectedNode.activity.slug)) {
      relatedCaseIds.add(session.id);
    }
  }
  const filtered = records.filter(
    (record) => "session_id" in record && relatedCaseIds.has(record.session_id)
  );
  if (filtered.length) {
    return filtered;
  }
  return workflowConformance ? [workflowConformance] : records;
}

function evidenceForSteps(
  steps: Step[],
  messages: Record<MessageId, Message>
): InspectorEvidence[] {
  return uniqueBy(
    steps.flatMap((step) =>
      step.evidence
        .map((ref) => messages[ref.message_id])
        .filter((message): message is Message => Boolean(message))
        .map((message) => ({
          author: message.author_label,
          caseId: step.session_id,
          id: `${step.id}:${message.id}`,
          permalink: message.permalink,
          quote: message.text,
          timestamp: message.received_at,
        }))
    ),
    (item) => item.id
  ).sort((a, b) => b.timestamp.localeCompare(a.timestamp));
}

function curationItemsForSteps(steps: Step[]): InspectorCurationItem[] {
  return steps
    .filter((step) => step.status !== "rejected")
    .map((step) => ({
      confidence: step.confidence,
      id: step.id,
      label: step.intent,
      reason:
        step.status === "proposed"
          ? "Needs human curation before it contributes to support."
          : `${step.lifecycle_state} ${step.modality} observation`,
      status: step.status,
    }));
}

function legacyEvidence(events: ActivityEvent[]): InspectorEvidence[] {
  return events.flatMap((event) => {
    if (event.messages?.length) {
      return event.messages.map((message) => ({
        author: message.author,
        caseId: event.caseId,
        id: `${event.id}:${message.ts}`,
        permalink: message.permalink || undefined,
        quote: message.text,
        timestamp: event.timestamp,
      }));
    }
    return [
      {
        author: event.actor,
        caseId: event.caseId,
        id: event.id,
        quote: `${event.action} on ${event.artifact}`,
        timestamp: event.timestamp,
      },
    ];
  });
}

function legacyCurationItems(events: ActivityEvent[]): InspectorCurationItem[] {
  return events
    .filter((event) => event.status !== "rejected")
    .map((event) => {
      let reason = "Confirmed simulation observation";
      if (event.status === "proposed") {
        reason = "Needs human curation before it contributes to support.";
      } else if (event.state) {
        reason = `${event.state} ${event.modality ?? "reported"} observation`;
      }
      return {
        confidence: event.confidence,
        id: event.id,
        label: `${event.action} on ${event.artifact}`,
        reason,
        status: event.status ?? "confirmed",
      };
    });
}

function legacyNodeConformance(
  selectedNode: ProcessNode
): InspectorConformanceSection[] {
  const sections: InspectorConformanceSection[] = [];
  if (selectedNode.plane === "designed" && selectedNode.count === 0) {
    sections.push({
      items: [
        "Documented activity has not been observed in the selected data.",
      ],
      title: "Missing work",
      tone: "warning",
    });
  }
  if (
    selectedNode.roleExpected &&
    selectedNode.roleExpected !== selectedNode.role
  ) {
    sections.push({
      items: [
        `Expected ${selectedNode.roleExpected}; observed ${selectedNode.role}.`,
      ],
      title: "Role deviation",
      tone: "warning",
    });
  }
  return sections;
}

function legacyEdgeConformance(
  selectedEdge: ProcessEdge
): InspectorConformanceSection[] {
  if (!selectedEdge.violates?.length) {
    return [];
  }
  return [
    {
      items: selectedEdge.violates.map((policy) => `${policy} is violated.`),
      title: "Policy violations",
      tone: "danger",
    },
  ];
}

function groupStepsBySession(steps: Step[]) {
  const grouped = new Map<string, Step[]>();
  for (const step of steps) {
    grouped.set(step.session_id, [
      ...(grouped.get(step.session_id) ?? []),
      step,
    ]);
  }
  for (const group of grouped.values()) {
    group.sort((a, b) => a.seq - b.seq || a.id.localeCompare(b.id));
  }
  return grouped;
}

function stepNodeId(step: Step): ActivityId | StepId {
  return step.activity_id ?? step.id;
}

function selectedCaseCount(steps: Step[]) {
  return new Set(steps.map((step) => step.session_id)).size;
}

function groundingMetric(steps: Step[]) {
  if (!steps.length) {
    return "0/0";
  }
  const grounded = steps.filter((step) => step.evidence.length > 0).length;
  return `${grounded}/${steps.length}`;
}

function groundedLegacyEvents(events: ActivityEvent[]) {
  return events.filter((event) =>
    event.messages?.some((message) => message.permalink)
  ).length;
}

function activityLabel(
  id: GraphEdge["from"] | GraphEdge["to"],
  nodesById: Map<string, GraphNode>
) {
  return nodesById.get(id)?.activity.label ?? id;
}

function policyLabel(policyId: string, kb: KnowledgeBase | null) {
  return (
    kb?.policies.find((policy) => policy.id === policyId)?.text ?? policyId
  );
}

function edgeKindLabel(kind: GraphEdge["kind"]) {
  return kind.replaceAll("_", " ");
}

function planeLabel(plane: string) {
  if (plane === "both") {
    return "Documented and observed";
  }
  if (plane === "designed") {
    return "Documented";
  }
  return "Discovered";
}

function percent(value: number) {
  return `${Math.round(value * 100)}%`;
}

function nullablePercent(value: number | null) {
  return value === null ? "n/a" : percent(value);
}

function emptyDetails(summary: string): InspectorDetails {
  return {
    badges: [],
    conformanceSections: [],
    curationItems: [],
    evidence: [],
    metrics: [],
    overviewPath: [],
    summary,
    title: "Inspector",
    type: "overview",
  };
}

function uniqueBy<T>(items: T[], key: (item: T) => string) {
  const seen = new Set<string>();
  const result: T[] = [];
  for (const item of items) {
    const id = key(item);
    if (!seen.has(id)) {
      seen.add(id);
      result.push(item);
    }
  }
  return result;
}

function uniqueStrings(items: string[]) {
  return [...new Set(items)];
}
