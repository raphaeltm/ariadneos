import type {
  Activity,
  ActivityId,
  EvidenceRef,
  GraphEdge,
  GraphEdgeId,
  GraphNode,
  GraphPlane,
  GraphView,
  Message,
  MissingActivity,
  PolicyId,
  PolicyViolation,
  ProcessSession,
  ProcessSessionId,
  RoleDeviation,
  SessionConformance,
  SlackTs,
  Snapshot,
  Step,
  UnreconciledWork,
  WorkflowConformance,
} from "../../shared/contracts.ts";
import {
  fixtureActivities,
  fixtureArtifacts,
  fixtureKb,
  fixturePeople,
  fixturePolicies,
  fixtureRoleRepertoires,
  fixtureWorkflowActivities,
  fixtureWorkflows,
} from "../../shared/fixtures.ts";
import {
  type ConformanceInput,
  type ConformanceResult,
  scoreConformance,
} from "../../shared/mining/conformance.ts";
import {
  type AggregateGraph,
  buildAggregateGraph,
  type DesignedWorkflowInput,
  type MiningSessionInput,
  type MiningStepInput,
} from "../../shared/mining/graph.ts";
import { canonicalize } from "../mining/canonicalize.ts";
import { extract } from "../mining/extract.ts";
import type {
  ExtractedStep,
  ExtractionContext,
  NormalizedObservation,
} from "../mining/types.ts";
import type { ModelAdapter, ModelJsonCall } from "../models.ts";
import {
  type DemoTranscript,
  generateDemoTranscripts,
  type ObservationSequence,
  scenarioById,
  transcriptToObservationSequence,
  validateDemoTranscript,
} from "./simulator.ts";

export type ReadinessStageName =
  | "conformance"
  | "extraction"
  | "mining"
  | "observations"
  | "transcripts"
  | "ui";

export interface ReadinessStage {
  detail: string;
  evidence: string[];
  name: ReadinessStageName;
  passed: boolean;
}

export interface DemoReadinessReport {
  generated_at: string;
  metrics: {
    expected_deviations: string[];
    extracted_steps: number;
    graph_edges: number;
    graph_nodes: number;
    messages: number;
    model_calls: number;
    sessions: number;
  };
  passed: boolean;
  snapshot?: Snapshot;
  stages: ReadinessStage[];
}

export interface DemoReadinessOptions {
  now?: Date;
  seed?: number;
  transcripts?: DemoTranscript[];
}

interface ExtractPayloadStep {
  activity_slug: string;
  actor_person_id: string | null;
  artifact_id: string | null;
  confidence: number;
  evidence: string[];
  handoff_to_person_id: string | null;
  intent: string;
  label: string;
  modality: "committed" | "negated" | "reported" | "requested";
  type: "action" | "approval" | "decision" | "handoff" | "rework" | "wait";
}

type AddExtractedStep = (
  activitySlug: string,
  overrides?: Partial<ExtractPayloadStep>
) => void;

interface ExtractionRule {
  add: (addStep: AddExtractedStep) => void;
  matches: (text: string) => boolean;
}

interface PipelineResult {
  canonical: Awaited<ReturnType<typeof canonicalize>>;
  extracted: ExtractedStep[];
  graph: AggregateGraph;
  messages: Message[];
  modelCalls: number;
  observations: NormalizedObservation[];
  sessions: ProcessSession[];
  snapshot: Snapshot;
  workflowConformance: ConformanceResult;
}

const labelBySlug = new Map(
  fixtureActivities.map((activity) => [activity.slug, activity.label])
);
const artifactBySlug = new Map<string, string>([
  ["capture_request", "art_req_vertex_sso"],
  ["communicate_decision", "art_req_vertex_sso"],
  ["create_epic", "art_req_vertex_sso"],
  ["deploy_fix", "art_inc_4412"],
  ["estimate_effort", "art_req_vertex_sso"],
  ["exec_approval", "art_req_vertex_sso"],
  ["hold_customer_call", "art_inc_4412"],
  ["improvise_hotfix", "art_inc_4412"],
  ["negotiate_scope_offline", "art_req_vertex_sso"],
  ["notify_customer", "art_inc_4412"],
  ["open_incident_ticket", "art_inc_4412"],
  ["reproduce_issue", "art_inc_4412"],
  ["roadmap_review", "art_req_vertex_sso"],
  ["root_cause_analysis", "art_inc_4412"],
  ["security_review", "art_sec_checklist"],
  ["triage_incident", "art_inc_4412"],
  ["update_roadmap", "art_roadmap_q4"],
  ["verify_resolution", "art_inc_4412"],
  ["write_postmortem", "art_inc_4412"],
]);

export async function runDemoReadinessGate(
  options: DemoReadinessOptions = {}
): Promise<DemoReadinessReport> {
  const generatedAt = (options.now ?? new Date()).toISOString();
  const transcripts =
    options.transcripts ??
    generateDemoTranscripts({ seed: options.seed }).transcripts;
  const transcriptValidations = transcripts.map(validateDemoTranscript);
  const transcriptStage: ReadinessStage = {
    detail: `${transcriptValidations.filter((item) => item.valid).length}/${transcriptValidations.length} transcripts valid`,
    evidence: transcriptValidations.flatMap((item) =>
      item.valid
        ? [`${item.scenario_id}/${item.variant}: valid`]
        : [`${item.scenario_id}/${item.variant}: ${item.errors.join(", ")}`]
    ),
    name: "transcripts",
    passed: transcriptValidations.every((item) => item.valid),
  };
  if (!transcriptStage.passed) {
    return emptyReport(generatedAt, [transcriptStage]);
  }

  const pipeline = await runPipeline(transcripts);
  const stages = [
    transcriptStage,
    observationStage(pipeline),
    extractionStage(pipeline),
    miningStage(pipeline, transcripts),
    conformanceStage(pipeline),
    uiStage(pipeline.snapshot),
  ];
  return {
    generated_at: generatedAt,
    metrics: {
      expected_deviations: expectedDeviations(transcripts),
      extracted_steps: pipeline.extracted.length,
      graph_edges: pipeline.graph.edges.length,
      graph_nodes: pipeline.graph.nodes.length,
      messages: pipeline.messages.length,
      model_calls: pipeline.modelCalls,
      sessions: pipeline.sessions.length,
    },
    passed: stages.every((stage) => stage.passed),
    snapshot: pipeline.snapshot,
    stages,
  };
}

export function evaluateUiSnapshot(snapshot: Snapshot): ReadinessStage {
  const messagesById = new Set(snapshot.messages.map((message) => message.id));
  const stepsWithMissingEvidence = snapshot.steps.filter((step) =>
    step.evidence.some((evidence) => !messagesById.has(evidence.message_id))
  );
  const graphEvidence =
    snapshot.graph.nodes.length > 0 && snapshot.graph.edges.length > 0;
  const conformanceEvidence = snapshot.conformance.length > 0;
  const passed =
    graphEvidence &&
    conformanceEvidence &&
    stepsWithMissingEvidence.length === 0 &&
    snapshot.graph.kind === "overlay";
  return {
    detail: passed
      ? "UI snapshot contains graph, evidence-linked steps and conformance"
      : "UI snapshot is incomplete",
    evidence: [
      `graph=${snapshot.graph.nodes.length} nodes/${snapshot.graph.edges.length} edges`,
      `messages=${snapshot.messages.length}`,
      `steps=${snapshot.steps.length}`,
      `conformance=${snapshot.conformance.length}`,
      `missingEvidence=${stepsWithMissingEvidence.length}`,
      `kind=${snapshot.graph.kind}`,
    ],
    name: "ui",
    passed,
  };
}

export async function assertDemoReadiness(
  options: DemoReadinessOptions = {}
): Promise<DemoReadinessReport> {
  const report = await runDemoReadinessGate(options);
  if (!report.passed) {
    const failed = report.stages
      .filter((stage) => !stage.passed)
      .map((stage) => `${stage.name}: ${stage.detail}`)
      .join("; ");
    throw new Error(`Demo readiness failed: ${failed}`);
  }
  return report;
}

async function runPipeline(
  transcripts: DemoTranscript[]
): Promise<PipelineResult> {
  const model = new TranscriptExtractionModel();
  const context = extractionContext();
  const sequences = transcripts.map((transcript) => {
    const sequence = transcriptToObservationSequence(transcript);
    return {
      sequence,
      session: toProcessSession(transcript, sequence.session),
    };
  });
  const extractionResults = await Promise.all(
    sequences.map(({ sequence }) =>
      extract(sequence.observations, [], context, model)
    )
  );
  const observations = sequences.flatMap(
    ({ sequence }) => sequence.observations
  );
  const messages = sequences.flatMap(({ sequence }) => sequence.messages);
  const sessions = sequences.map(({ session }) => session);
  const extracted = extractionResults.flatMap((result) => result.steps);
  const canonical = await canonicalize(extracted, context.activities);
  const graph = buildAggregateGraph({
    scope: {},
    sessions: sessions.map(toMiningSession),
    steps: canonical.steps.map(toMiningStep),
    workflows: designedWorkflows(),
  });
  const workflowConformance = scoreConformance(
    conformanceInput(canonical.steps.map(toMiningStep), sessions, messages)
  );
  const snapshot = toSnapshot(
    graph,
    workflowConformance,
    sessions,
    messages,
    canonical.steps
  );
  return {
    canonical,
    extracted,
    graph,
    messages,
    modelCalls: model.calls,
    observations,
    sessions,
    snapshot,
    workflowConformance,
  };
}

function emptyReport(
  generatedAt: string,
  stages: ReadinessStage[]
): DemoReadinessReport {
  return {
    generated_at: generatedAt,
    metrics: {
      expected_deviations: [],
      extracted_steps: 0,
      graph_edges: 0,
      graph_nodes: 0,
      messages: 0,
      model_calls: 0,
      sessions: 0,
    },
    passed: false,
    stages,
  };
}

function observationStage(pipeline: PipelineResult): ReadinessStage {
  const personas = new Set(
    pipeline.observations
      .map((observation) => observation.author_person_id)
      .filter(Boolean)
  );
  const missingSession = pipeline.observations.filter(
    (observation) => !observation.session_id
  );
  const missingPermalink = pipeline.messages.filter(
    (message) => !message.permalink
  );
  const passed =
    pipeline.observations.length >= 35 &&
    personas.size >= 6 &&
    missingSession.length === 0 &&
    missingPermalink.length === 0;
  return {
    detail: passed
      ? "Slack-like observations preserve personas, sessions and permalinks"
      : "Observation sequence is incomplete",
    evidence: [
      `observations=${pipeline.observations.length}`,
      `personas=${personas.size}`,
      `missingSession=${missingSession.length}`,
      `missingPermalink=${missingPermalink.length}`,
    ],
    name: "observations",
    passed,
  };
}

function extractionStage(pipeline: PipelineResult): ReadinessStage {
  const degraded =
    pipeline.extracted.length === 0 || pipeline.canonical.degraded;
  const confirmed = pipeline.canonical.steps.filter(
    (step) => step.status === "confirmed"
  );
  return {
    detail: degraded
      ? "Extraction produced no usable confirmed steps"
      : "Extraction and canonicalization produced confirmed evidence-backed steps",
    evidence: [
      `extracted=${pipeline.extracted.length}`,
      `canonical=${pipeline.canonical.steps.length}`,
      `confirmed=${confirmed.length}`,
      `modelCalls=${pipeline.modelCalls}`,
      `warnings=${[...pipeline.canonical.warnings].join("|") || "none"}`,
    ],
    name: "extraction",
    passed: !degraded && confirmed.length >= 25,
  };
}

function miningStage(
  pipeline: PipelineResult,
  transcripts: readonly DemoTranscript[]
): ReadinessStage {
  const found = foundDeviations(pipeline.graph);
  const missing = expectedDeviations(transcripts).filter(
    (deviation) => !found.has(deviation)
  );
  const passed =
    pipeline.graph.stats.sessions >= 3 &&
    pipeline.graph.nodes.length >= 10 &&
    pipeline.graph.edges.length >= 8 &&
    missing.length === 0;
  return {
    detail: passed
      ? "Graph contains designed and discovered demo behavior"
      : "Graph is missing expected demo behavior",
    evidence: [
      `sessions=${pipeline.graph.stats.sessions}`,
      `nodes=${pipeline.graph.nodes.length}`,
      `edges=${pipeline.graph.edges.length}`,
      `missingExpected=${missing.join(",") || "none"}`,
      `revision=${pipeline.graph.revision}`,
    ],
    name: "mining",
    passed,
  };
}

function conformanceStage(pipeline: PipelineResult): ReadinessStage {
  const { rollup, sessions } = pipeline.workflowConformance;
  const violations = sessions.flatMap((session) => session.violations);
  const { grounding } = rollup;
  const passed =
    sessions.length === pipeline.sessions.length &&
    violations.length >= 1 &&
    grounding.groundedRatio !== null &&
    grounding.groundedRatio >= 0.9;
  return {
    detail: passed
      ? "Conformance reports grounded policy deviations"
      : "Conformance did not report expected grounded deviations",
    evidence: [
      `sessions=${sessions.length}`,
      `violations=${violations.length}`,
      `groundedRatio=${grounding.groundedRatio ?? "null"}`,
      `fitness=${rollup.fitness ?? "null"}`,
    ],
    name: "conformance",
    passed,
  };
}

function uiStage(snapshot: Snapshot): ReadinessStage {
  return evaluateUiSnapshot(snapshot);
}

function expectedDeviations(transcripts: readonly DemoTranscript[]) {
  return [...new Set(transcripts.flatMap((item) => item.expected_deviations))];
}

function foundDeviations(graph: AggregateGraph) {
  const slugs = new Set(
    graph.nodes.filter((node) => node.occurrences > 0).map((node) => node.slug)
  );
  if (graph.edges.some((edge) => edge.kind === "rework")) {
    slugs.add("rework_edge");
  }
  return slugs;
}

class TranscriptExtractionModel implements ModelAdapter {
  calls = 0;

  generateJson(call: ModelJsonCall): Promise<unknown> {
    this.calls += 1;
    if (call.task !== "extract") {
      return Promise.resolve({ matches: [] });
    }
    const prompt = JSON.parse(call.messages.at(-1)?.content ?? "{}") as {
      messages?: NormalizedObservation[];
    };
    return Promise.resolve({
      steps: (prompt.messages ?? []).flatMap((message) =>
        stepsForObservation(message)
      ),
    });
  }
}

const extractionRules: readonly ExtractionRule[] = [
  {
    add: (addStep) => addStep("detect_incident"),
    matches: (text) => text.includes("checkout") && text.includes("500"),
  },
  {
    add: (addStep) => addStep("triage_incident"),
    matches: (text) => text.includes("calling this a p1"),
  },
  {
    add: (addStep) => addStep("open_incident_ticket"),
    matches: (text) => text.includes("opened inc-4412"),
  },
  {
    add: (addStep) =>
      addStep("assign_owner", {
        handoff_to_person_id: "per_tom",
        type: "handoff",
      }),
    matches: (text) =>
      text.includes("incident owner") || text.includes("tom owns"),
  },
  {
    add: (addStep) => addStep("escalate_to_ceo", { type: "decision" }),
    matches: (text) =>
      text.includes("biggest logo") && text.includes("fix now"),
  },
  {
    add: (addStep) => addStep("reproduce_issue"),
    matches: (text) => text.includes("reproduced it"),
  },
  {
    add: (addStep) => addStep("root_cause_analysis"),
    matches: (text) =>
      text.includes("root cause") || text.includes("second cause"),
  },
  {
    add: (addStep) => addStep("security_review"),
    matches: (text) => text.includes("security checklist passed"),
  },
  {
    add: (addStep) =>
      addStep("security_review", {
        modality: "negated",
        type: "decision",
      }),
    matches: (text) => text.includes("skipping the security checklist"),
  },
  {
    add: (addStep) => addStep("improvise_hotfix"),
    matches: (text) =>
      text.includes("push a mitigation") || text.includes("hotfix is out"),
  },
  {
    add: (addStep) => addStep("deploy_fix"),
    matches: (text) =>
      text.includes("fix is deployed") ||
      text.includes("deployed the first fix") ||
      text.includes("deployed the corrected fix"),
  },
  {
    add: (addStep) => addStep("verify_resolution"),
    matches: (text) =>
      text.includes("error rate") || text.includes("verification passes"),
  },
  {
    add: (addStep) =>
      addStep("verify_resolution", {
        modality: "negated",
        type: "rework",
      }),
    matches: (text) => text.includes("verification failed"),
  },
  {
    add: (addStep) => addStep("notify_customer"),
    matches: (text) =>
      text.includes("emailed vertex") || text.includes("customer update"),
  },
  {
    add: (addStep) => addStep("hold_customer_call"),
    matches: (text) => text.includes("calling vertex now"),
  },
  {
    add: (addStep) => addStep("write_postmortem", { modality: "requested" }),
    matches: (text) => text.includes("postmortem"),
  },
  {
    add: (addStep) => addStep("capture_request"),
    matches: (text) => text.includes("captured req-88"),
  },
  {
    add: (addStep) => addStep("qualify_business_case"),
    matches: (text) => text.includes("business case is qualified"),
  },
  {
    add: (addStep) => addStep("estimate_effort"),
    matches: (text) =>
      text.includes("estimate is three weeks") ||
      text.includes("engineering weeks"),
  },
  {
    add: (addStep) => addStep("roadmap_review", { type: "approval" }),
    matches: (text) => text.includes("roadmap review is approved"),
  },
  {
    add: (addStep) => addStep("exec_approval", { type: "approval" }),
    matches: (text) => text.includes("approved from exec"),
  },
  {
    add: (addStep) => addStep("update_roadmap"),
    matches: (text) => text.includes("added it to the q4 roadmap"),
  },
  {
    add: (addStep) => addStep("communicate_decision"),
    matches: (text) => text.includes("communicated the decision"),
  },
  {
    add: (addStep) => addStep("create_epic"),
    matches: (text) =>
      text.includes("created the epic") ||
      text.includes("created a provisional epic"),
  },
  {
    add: (addStep) => {
      addStep("negotiate_scope_offline", { type: "decision" });
      addStep("update_roadmap");
    },
    matches: (text) => text.includes("already promised vertex"),
  },
];

function stepsForObservation(
  message: NormalizedObservation
): ExtractPayloadStep[] {
  const steps: ExtractPayloadStep[] = [];
  const add = (
    activitySlug: string,
    overrides: Partial<ExtractPayloadStep> = {}
  ) => {
    steps.push({
      activity_slug: activitySlug,
      actor_person_id: message.author_person_id,
      artifact_id: artifactBySlug.get(activitySlug) ?? null,
      confidence: 0.86,
      evidence: [message.ts],
      handoff_to_person_id: null,
      intent: intentFor(activitySlug),
      label: labelBySlug.get(activitySlug) ?? labelFromSlug(activitySlug),
      modality: "reported",
      type: "action",
      ...overrides,
    });
  };
  const lower = message.text.toLowerCase();
  for (const rule of extractionRules) {
    if (rule.matches(lower)) {
      rule.add(add);
    }
  }
  return steps;
}

function extractionContext(): ExtractionContext {
  return {
    activities: fixtureActivities.map((activity) => ({
      id: activity.id,
      label: activity.label,
      plane: activity.plane,
      role_expected: activity.role_expected,
      slug: activity.slug,
    })),
    artifacts: fixtureArtifacts.map((artifact) => ({
      id: artifact.id,
      name: artifact.name,
    })),
    people: fixturePeople.map((person) => ({
      id: person.id,
      name: person.name,
      role: person.role,
    })),
    role_repertoires: fixtureRoleRepertoires,
  };
}

function toProcessSession(
  transcript: DemoTranscript,
  session: ObservationSequence["session"]
): ProcessSession {
  const scenario = scenarioById(transcript.scenario_id);
  return {
    channel: scenario.channel,
    ended_ts: session.ended_ts,
    extra: [],
    fitness: null,
    id: session.id,
    missing: [],
    project_id: transcript.project_id,
    scenario_id: transcript.scenario_id,
    source: "simulation",
    started_ts: session.started_ts,
    status: "closed",
    suggested: false,
    variant: transcript.variant,
    violations: [],
    workflow_id: transcript.workflow_id,
    workspace_id: scenario.workspace_id,
  };
}

function toMiningSession(session: ProcessSession): MiningSessionInput {
  return {
    id: session.id,
    projectId: session.project_id,
    workflowId: session.workflow_id,
  };
}

function toMiningStep(step: ExtractedStep): MiningStepInput {
  const actor = fixturePeople.find(
    (person) => person.id === step.actor_person_id
  );
  return {
    activityId: step.activity_id,
    activityLabel: step.label,
    activitySlug: step.activity_slug,
    actorPersonId: step.actor_person_id,
    actorRole: actor?.role ?? null,
    curation: step.status,
    evidence: step.evidence.map((item) => item.ts),
    handoffToPersonId: step.handoff_to_person_id,
    id: step.id,
    lifecycle: step.lifecycle_state,
    modality: step.modality,
    negated: step.negated,
    projectId:
      fixtureActivities.find((activity) => activity.slug === step.activity_slug)
        ?.project_id ?? null,
    seq: step.seq,
    sessionId: step.session_id,
    tsStart: step.ts_start,
    type: step.type,
    workflowId: sessionWorkflowId(step.session_id),
  };
}

function designedWorkflows(): DesignedWorkflowInput[] {
  return fixtureWorkflows.map((workflow) => ({
    activities: workflow.activity_slugs.map((slug, index) => {
      const activity = fixtureActivities.find(
        (candidate) => candidate.slug === slug
      );
      const workflowActivity = fixtureWorkflowActivities.find(
        (candidate) =>
          candidate.workflow_id === workflow.id &&
          candidate.activity_id === activity?.id
      );
      return {
        id: activity?.id,
        label: activity?.label,
        policyIds:
          fixtureActivities.find((candidate) => candidate.slug === slug)
            ?.policy_ids ?? [],
        rank: workflowActivity?.rank ?? index,
        roleExpected: workflowActivity?.role_expected ?? null,
        slug,
      };
    }),
    entryActivitySlug: workflow.entry_activity,
    exitActivitySlugs: workflow.exit_activities,
    id: workflow.id,
    matrix: workflow.matrix,
    name: workflow.name,
    projectId: workflow.project_id,
  }));
}

function conformanceInput(
  steps: MiningStepInput[],
  sessions: ProcessSession[],
  messages: Message[]
): ConformanceInput {
  const heliosWorkflow = fixtureWorkflows.find(
    (workflow) => workflow.id === "wf_p1_incident"
  );
  if (!heliosWorkflow) {
    throw new Error("Missing Helios workflow.");
  }
  return {
    artifacts: fixtureArtifacts.map((artifact) => ({
      id: artifact.id,
      projectId: artifact.project_id,
      unit: artifact.unit,
      value: artifact.value,
    })),
    evidence: messages.map((message) => ({
      authorized: true,
      permalink: message.permalink,
      quote: message.text,
      ts: message.ts,
    })),
    people: fixturePeople.map((person) => ({
      id: person.id,
      role: person.role,
    })),
    policies: fixturePolicies.map((policy) => ({
      activitySlug: policy.activity_slug,
      id: policy.id,
      kind: policy.kind,
      params: policy.params,
      projectId: policy.project_id,
      text: policy.text,
    })),
    sessions: sessions.map((session) => ({
      id: session.id,
      projectId: session.project_id,
      status: session.status,
      workflowId: session.workflow_id,
    })),
    steps: steps.map((step) => ({
      activitySlug: step.activitySlug,
      actorPersonId: step.actorPersonId,
      artifactId:
        step.activitySlug === "estimate_effort"
          ? "art_req_vertex_sso"
          : (artifactBySlug.get(step.activitySlug) ?? undefined),
      confidence: 0.86,
      effortDays: step.activitySlug === "estimate_effort" ? 21 : undefined,
      evidence: step.evidence ?? [],
      id: step.id,
      seq: step.seq,
      sessionId: step.sessionId,
      state: step.lifecycle ?? "done",
      status: step.curation ?? "confirmed",
      type: step.type,
    })),
    workflow: {
      activities: heliosWorkflow.activity_slugs.map((slug) => ({
        expectedRole:
          fixtureWorkflowActivities.find(
            (activity) =>
              activity.workflow_id === heliosWorkflow.id &&
              activity.activity_id === `act_${slug}`
          )?.role_expected ?? undefined,
        label: labelBySlug.get(slug),
        slug,
      })),
      activitySlugs: heliosWorkflow.activity_slugs,
      id: heliosWorkflow.id,
      matrix: heliosWorkflow.matrix,
      projectId: heliosWorkflow.project_id,
    },
  };
}

function toSnapshot(
  graph: AggregateGraph,
  conformance: ConformanceResult,
  sessions: ProcessSession[],
  messages: Message[],
  steps: ExtractedStep[]
): Snapshot {
  const messagesByTs = new Map(
    messages.map((message) => [message.ts, message])
  );
  const sessionConformance = conformance.sessions.map((session) =>
    toSessionConformance(session, "wf_p1_incident", messagesByTs)
  );
  const workflowConformance = toWorkflowConformance(conformance);
  return {
    conformance: sessionConformance,
    cursor: 1,
    graph: toGraphView(graph, workflowConformance),
    kb: fixtureKb,
    messages,
    sessions,
    steps: steps.map(toContractStep),
  };
}

function toGraphView(
  graph: AggregateGraph,
  conformance: WorkflowConformance
): GraphView {
  return {
    conformance,
    edges: graph.edges.map(toGraphEdge),
    generated_at: new Date("2026-09-12T09:30:00.000Z").toISOString(),
    happy_path: graph.happyPath.map(
      (step) => `ged_${step.slug}` as GraphEdgeId
    ),
    key: `overlay:proj_helios:wf_p1_incident:${graph.revision}`,
    kind: "overlay",
    min_support: 1,
    nodes: graph.nodes.map(toGraphNode),
    project_id: "proj_helios",
    revision: Number.parseInt(graph.revision.slice(0, 8), 36),
    workflow_id: "wf_p1_incident",
  };
}

function toGraphNode(node: AggregateGraph["nodes"][number]): GraphNode {
  return {
    activity: {
      authored_synonyms: [],
      description: `${node.label} observed during demo readiness.`,
      first_seen_ts: node.firstSeenTs ?? undefined,
      id: node.id as ActivityId,
      label: node.label,
      occurrences: node.occurrences,
      plane: node.plane,
      policy_ids: node.policyIds as PolicyId[],
      project_id:
        fixtureActivities.find((activity) => activity.slug === node.slug)
          ?.project_id ?? "proj_helios",
      role_expected: node.roleExpected as Activity["role_expected"],
      roles_observed: node.roles.map(
        (role) => role.role
      ) as Activity["roles_observed"],
      slug: node.slug,
      support: node.support,
    },
    id: node.id as ActivityId,
    role_deviations: [],
    unreconciled: [],
  };
}

function toGraphEdge(edge: AggregateGraph["edges"][number]): GraphEdge {
  return {
    cases: edge.cases as ProcessSessionId[],
    from: edge.source as ActivityId,
    id: `ged_${edge.id}` as GraphEdgeId,
    is_back_edge: edge.isBackEdge,
    kind: edge.kind,
    observed_support: edge.support,
    plane: edge.plane as GraphPlane,
    probability: edge.probability,
    to: edge.target as ActivityId,
    violates: [],
    weight: edge.occurrences,
  };
}

function toContractStep(step: ExtractedStep): Step {
  return {
    activity_id: step.activity_id,
    actor_person_id: step.actor_person_id,
    artifact_id: step.artifact_id,
    confidence: step.confidence,
    evidence: step.evidence.map(toEvidenceRef),
    handoff_to_person_id: step.handoff_to_person_id,
    id: step.id,
    intent: step.intent,
    lifecycle_state: step.lifecycle_state,
    modality: step.modality,
    negated: step.negated,
    seq: step.seq,
    session_id: step.session_id as ProcessSessionId,
    status: step.status,
    ts_end: null,
    ts_start: step.ts_start,
    type: step.type,
  };
}

function toSessionConformance(
  session: ConformanceResult["sessions"][number],
  workflowId: string,
  messagesByTs: ReadonlyMap<string, Message>
): SessionConformance {
  return {
    extra: session.controlFlow.extra.map((slug) => ({
      occurrences: 1,
      slug,
    })),
    fitness: session.controlFlow.fitness,
    missing: session.controlFlow.missing.map((slug) => ({
      of: 1,
      seen_in_sessions: 0,
      slug,
    })),
    order_breaks: session.controlFlow.orderBreaks.map((orderBreak) => ({
      expected_between: orderBreak.expectedBetween.join(",") || null,
      from: orderBreak.from,
      to: orderBreak.to,
    })),
    precision: session.controlFlow.precision,
    role_deviations: session.roleDeviations.map((deviation) =>
      toContractRoleDeviation(deviation, session.sessionId, messagesByTs)
    ),
    session_id: session.sessionId as ProcessSessionId,
    unreconciled: [
      ...session.unreconciledCommitments,
      ...session.abandonedCommitments,
    ].map((finding) => toUnreconciledWork(finding, messagesByTs)),
    violations: session.violations.map((violation) =>
      toPolicyViolation(violation, messagesByTs)
    ),
    workflow_id: workflowId as SessionConformance["workflow_id"],
  };
}

function toWorkflowConformance(result: ConformanceResult): WorkflowConformance {
  const missing: MissingActivity[] = Object.entries(result.rollup.missingCounts)
    .map(([slug, count]) => ({
      of: result.rollup.sessions,
      seen_in_sessions: result.rollup.sessions - count,
      slug,
    }))
    .sort((a, b) => a.slug.localeCompare(b.slug));
  return {
    closed_sessions: result.rollup.closedSessions,
    extra: Object.entries(result.rollup.extraCounts).map(([slug, count]) => ({
      occurrences: count,
      slug,
    })),
    fitness: result.rollup.fitness,
    missing,
    open_sessions: result.rollup.openSessions,
    order_breaks: [],
    precision: result.rollup.precision,
    role_deviations: [],
    unreconciled: [],
    violations: [],
    workflow_id: result.workflowId as WorkflowConformance["workflow_id"],
  };
}

function toContractRoleDeviation(
  deviation: ConformanceResult["sessions"][number]["roleDeviations"][number],
  sessionId: string,
  messagesByTs: ReadonlyMap<string, Message>
): RoleDeviation {
  return {
    activity_id: activityIdForSlug(deviation.activitySlug),
    evidence: deviation.evidence.map((item) =>
      toEvidenceRefFromTs(item.messageTs, messagesByTs)
    ),
    expected: deviation.expectedRole as RoleDeviation["expected"],
    observed: deviation.actorRole as RoleDeviation["observed"],
    of: 1,
    sessions: [sessionId as ProcessSessionId],
  };
}

function toUnreconciledWork(
  finding: ConformanceResult["sessions"][number]["unreconciledCommitments"][number],
  messagesByTs: ReadonlyMap<string, Message>
): UnreconciledWork {
  return {
    actor_person_id: (finding.actorPersonId ??
      null) as UnreconciledWork["actor_person_id"],
    evidence: finding.evidence.map((item) =>
      toEvidenceRefFromTs(item.messageTs, messagesByTs)
    ),
    reason: finding.state === "abandoned" ? "abandoned" : "still_open",
    state: finding.state,
    step_id: finding.stepId as UnreconciledWork["step_id"],
  };
}

function toPolicyViolation(
  violation: ConformanceResult["sessions"][number]["violations"][number],
  messagesByTs: ReadonlyMap<string, Message>
): PolicyViolation {
  const policy = fixturePolicies.find((item) => item.id === violation.policyId);
  return {
    evidence: violation.evidence.map((item) =>
      toEvidenceRefFromTs(item.messageTs, messagesByTs)
    ),
    policy_id: violation.policyId as PolicyId,
    quote: violation.evidence[0]?.quote ?? violation.reason,
    text: policy?.text ?? violation.reason,
  };
}

function toEvidenceRef(
  evidence: ExtractedStep["evidence"][number]
): EvidenceRef {
  return {
    channel: evidence.channel_id,
    message_id:
      `${evidence.workspace_id}:${evidence.channel_id}:${evidence.ts}` as EvidenceRef["message_id"],
    message_revision: evidence.message_revision,
    ts: evidence.ts as SlackTs,
    workspace_id: evidence.workspace_id,
  };
}

function toEvidenceRefFromTs(
  ts: string,
  messagesByTs: ReadonlyMap<string, Message>
): EvidenceRef {
  const message = messagesByTs.get(ts);
  return {
    channel: message?.channel ?? "C_HELIOS_OPS",
    message_id:
      message?.id ??
      (`T_ARIADNEOS_DEMO:C_HELIOS_OPS:${ts}` as EvidenceRef["message_id"]),
    message_revision: message?.revision ?? 1,
    ts: ts as SlackTs,
    workspace_id: message?.workspace_id ?? "T_ARIADNEOS_DEMO",
  };
}

function sessionWorkflowId(sessionId: string) {
  return sessionId.includes("atlas_feature")
    ? "wf_feature_intake"
    : "wf_p1_incident";
}

function activityIdForSlug(slug: string): ActivityId {
  return `act_${slug}` as ActivityId;
}

function labelFromSlug(slug: string) {
  return slug
    .split("_")
    .map((part) => `${part.charAt(0).toUpperCase()}${part.slice(1)}`)
    .join(" ");
}

function intentFor(slug: string) {
  return labelBySlug.get(slug) ?? labelFromSlug(slug);
}
