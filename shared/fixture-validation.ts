import type {
  ActivityId,
  EntityId,
  EvidenceRef,
  GraphDelta,
  GraphView,
  JournalEnvelope,
  Message,
  PromiseReportReconciliation,
  Snapshot,
  Step,
} from "./contracts.ts";
import {
  errorFixtures,
  fixtureCitations,
  fixtureCommands,
  fixtureSnapshot,
  promiseReportReconciliationFixtures,
  removalDelta,
  replayJournal,
} from "./fixtures.ts";

export interface ContractFixtureSet {
  deltas: GraphDelta[];
  errors: unknown[];
  journal: JournalEnvelope[];
  reconciliations: PromiseReportReconciliation[];
  snapshot: Snapshot;
  supportingRecords: unknown[];
}

export interface FixtureValidationResult {
  errors: string[];
  ok: boolean;
}

export const contractFixtureSet: ContractFixtureSet = {
  deltas: [removalDelta],
  errors: errorFixtures,
  journal: replayJournal,
  reconciliations: promiseReportReconciliationFixtures,
  snapshot: fixtureSnapshot,
  supportingRecords: [fixtureCommands, fixtureCitations],
};

export function validateFixtureSet(
  fixtureSet: ContractFixtureSet = contractFixtureSet
): FixtureValidationResult {
  const errors: string[] = [];
  validateSnapshot(fixtureSet.snapshot, errors);
  validateReconciliations(
    fixtureSet.reconciliations,
    fixtureSet.snapshot.steps,
    errors
  );
  for (const delta of fixtureSet.deltas) {
    validateDelta(delta, fixtureSet.snapshot.graph, errors);
  }
  validateJournal(fixtureSet.journal, fixtureSet.snapshot, errors);
  validateErrorFixtures(fixtureSet.errors, errors);
  return { errors, ok: errors.length === 0 };
}

export function assertValidFixtureSet(
  fixtureSet: ContractFixtureSet = contractFixtureSet
) {
  const result = validateFixtureSet(fixtureSet);
  if (!result.ok) {
    throw new Error(
      `Contract fixtures are invalid:\n${result.errors.join("\n")}`
    );
  }
}

function validateSnapshot(snapshot: Snapshot, errors: string[]) {
  const ids = collectIds(snapshot);
  const messageById = new Map(
    snapshot.messages.map((message) => [message.id, message])
  );
  const sessionIds = new Set(snapshot.sessions.map((session) => session.id));

  validateWorkflows(snapshot, ids, errors);
  validateKbRefs(snapshot, ids, errors);
  validateSessions(snapshot, ids, errors);
  validateMessages(snapshot, sessionIds, errors);
  for (const step of snapshot.steps) {
    validateStep(step, ids, sessionIds, messageById, errors);
  }
  validateActivitySupport(snapshot, errors);
  validateGraph(snapshot.graph, ids, errors);
  validateConformance(snapshot, ids, sessionIds, messageById, errors);
}

function validateWorkflows(snapshot: Snapshot, ids: IdIndex, errors: string[]) {
  for (const workflow of snapshot.kb.workflows) {
    if (!ids.projects.has(workflow.project_id)) {
      errors.push(
        `workflow ${workflow.id} references unknown project ${workflow.project_id}`
      );
    }
    if (workflow.matrix.length !== workflow.activity_slugs.length) {
      errors.push(
        `workflow ${workflow.id} matrix row count does not match activity_slugs`
      );
    }
    workflow.matrix.forEach((row, index) => {
      if (row.length !== workflow.activity_slugs.length) {
        errors.push(
          `workflow ${workflow.id} matrix row ${index} has the wrong width`
        );
      }
    });
  }
}

function validateKbRefs(snapshot: Snapshot, ids: IdIndex, errors: string[]) {
  for (const activity of snapshot.kb.activities) {
    for (const policyId of activity.policy_ids) {
      if (!ids.policies.has(policyId)) {
        errors.push(
          `activity ${activity.id} references unknown policy ${policyId}`
        );
      }
    }
  }

  for (const artifact of snapshot.kb.artifacts) {
    if (!ids.projects.has(artifact.project_id)) {
      errors.push(
        `artifact ${artifact.id} references unknown project ${artifact.project_id}`
      );
    }
  }
}

function validateSessions(snapshot: Snapshot, ids: IdIndex, errors: string[]) {
  for (const session of snapshot.sessions) {
    if (!ids.projects.has(session.project_id)) {
      errors.push(
        `session ${session.id} references unknown project ${session.project_id}`
      );
    }
    if (session.workflow_id && !ids.workflows.has(session.workflow_id)) {
      errors.push(
        `session ${session.id} references unknown workflow ${session.workflow_id}`
      );
    }
  }
}

function validateMessages(
  snapshot: Snapshot,
  sessionIds: ReadonlySet<string>,
  errors: string[]
) {
  for (const message of snapshot.messages) {
    if (!sessionIds.has(message.session_id)) {
      errors.push(
        `message ${message.id} references unknown session ${message.session_id}`
      );
    }
    if (
      message.id !== `${message.workspace_id}:${message.channel}:${message.ts}`
    ) {
      errors.push(`message ${message.id} does not match workspace/channel/ts`);
    }
  }
}

function validateConformance(
  snapshot: Snapshot,
  ids: IdIndex,
  sessionIds: ReadonlySet<string>,
  messageById: ReadonlyMap<string, Message>,
  errors: string[]
) {
  for (const conformance of snapshot.conformance) {
    if (!sessionIds.has(conformance.session_id)) {
      errors.push(
        `conformance references unknown session ${conformance.session_id}`
      );
    }
    for (const violation of conformance.violations) {
      if (!ids.policies.has(violation.policy_id)) {
        errors.push(
          `violation references unknown policy ${violation.policy_id}`
        );
      }
      validateEvidenceRefs(
        `violation ${violation.policy_id}`,
        violation.evidence,
        messageById,
        errors
      );
    }
  }
}

function validateStep(
  step: Step,
  ids: IdIndex,
  sessionIds: ReadonlySet<string>,
  messageById: ReadonlyMap<string, Message>,
  errors: string[]
) {
  if (!sessionIds.has(step.session_id)) {
    errors.push(
      `step ${step.id} references unknown session ${step.session_id}`
    );
  }
  if (step.activity_id && !ids.activities.has(step.activity_id)) {
    errors.push(
      `step ${step.id} references unknown activity ${step.activity_id}`
    );
  }
  if (step.actor_person_id && !ids.people.has(step.actor_person_id)) {
    errors.push(
      `step ${step.id} references unknown actor ${step.actor_person_id}`
    );
  }
  if (step.handoff_to_person_id && !ids.people.has(step.handoff_to_person_id)) {
    errors.push(
      `step ${step.id} references unknown handoff target ${step.handoff_to_person_id}`
    );
  }
  if (step.artifact_id && !ids.artifacts.has(step.artifact_id)) {
    errors.push(
      `step ${step.id} references unknown artifact ${step.artifact_id}`
    );
  }
  if (!step.evidence.length) {
    errors.push(`step ${step.id} has no evidence`);
  }
  validateEvidenceRefs(`step ${step.id}`, step.evidence, messageById, errors);
  if (
    step.modality === "negated" &&
    !(step.negated && step.lifecycle_state === "skipped")
  ) {
    errors.push(`step ${step.id} has inconsistent negated modality/state`);
  }
}

function validateEvidenceRefs(
  owner: string,
  evidenceRefs: readonly EvidenceRef[],
  messageById: ReadonlyMap<string, Message>,
  errors: string[]
) {
  for (const ref of evidenceRefs) {
    const message = messageById.get(ref.message_id);
    if (!message) {
      errors.push(`${owner} references missing evidence ${ref.message_id}`);
      continue;
    }
    if (
      ref.workspace_id !== message.workspace_id ||
      ref.channel !== message.channel ||
      ref.ts !== message.ts
    ) {
      errors.push(`${owner} evidence ${ref.message_id} has inconsistent scope`);
    }
    if (ref.message_revision !== message.revision) {
      errors.push(`${owner} evidence ${ref.message_id} has stale revision`);
    }
    if (message.deleted || message.availability !== "available") {
      errors.push(`${owner} evidence ${ref.message_id} is unavailable`);
    }
  }
}

function validateGraph(graph: GraphView, ids: IdIndex, errors: string[]) {
  const graphNodeIds = new Set(graph.nodes.map((nodeItem) => nodeItem.id));
  if (graph.revision < 0 || !Number.isInteger(graph.revision)) {
    errors.push(`graph ${graph.key} has invalid revision ${graph.revision}`);
  }
  if (!ids.projects.has(graph.project_id)) {
    errors.push(
      `graph ${graph.key} references unknown project ${graph.project_id}`
    );
  }
  if (graph.workflow_id && !ids.workflows.has(graph.workflow_id)) {
    errors.push(
      `graph ${graph.key} references unknown workflow ${graph.workflow_id}`
    );
  }
  for (const graphNode of graph.nodes) {
    if (!ids.activities.has(graphNode.activity.id)) {
      errors.push(
        `graph ${graph.key} contains unknown activity ${graphNode.activity.id}`
      );
    }
    if (graphNode.id !== graphNode.activity.id) {
      errors.push(
        `graph node ${graphNode.id} does not match activity ${graphNode.activity.id}`
      );
    }
  }
  for (const graphEdge of graph.edges) {
    if (!(graphNodeIds.has(graphEdge.from) && graphNodeIds.has(graphEdge.to))) {
      errors.push(`graph edge ${graphEdge.id} references nodes outside graph`);
    }
    if (graphEdge.observed_support !== graphEdge.cases.length) {
      errors.push(`graph edge ${graphEdge.id} support does not match cases`);
    }
  }
}

function validateActivitySupport(snapshot: Snapshot, errors: string[]) {
  const support = new Map<string, Set<string>>();
  const occurrences = new Map<string, number>();
  for (const step of snapshot.steps) {
    if (
      step.activity_id &&
      step.lifecycle_state === "done" &&
      step.status === "confirmed" &&
      !step.negated
    ) {
      const sessions = support.get(step.activity_id) ?? new Set<string>();
      sessions.add(step.session_id);
      support.set(step.activity_id, sessions);
      occurrences.set(
        step.activity_id,
        (occurrences.get(step.activity_id) ?? 0) + 1
      );
    }
  }
  for (const activity of snapshot.kb.activities) {
    const expectedSupport = support.get(activity.id)?.size ?? 0;
    const expectedOccurrences = occurrences.get(activity.id) ?? 0;
    if (activity.support !== expectedSupport) {
      errors.push(
        `activity ${activity.id} support ${activity.support} does not match done confirmed sessions ${expectedSupport}`
      );
    }
    if (activity.occurrences !== expectedOccurrences) {
      errors.push(
        `activity ${activity.id} occurrences ${activity.occurrences} does not match done confirmed steps ${expectedOccurrences}`
      );
    }
  }
}

function validateReconciliations(
  reconciliations: readonly PromiseReportReconciliation[],
  steps: readonly Step[],
  errors: string[]
) {
  const stepIds = new Set(steps.map((step) => step.id));
  for (const reconciliation of reconciliations) {
    if (!stepIds.has(reconciliation.source_step_id)) {
      errors.push(
        `reconciliation references unknown source step ${reconciliation.source_step_id}`
      );
    }
    if (!stepIds.has(reconciliation.report_step_id)) {
      errors.push(
        `reconciliation references unknown report step ${reconciliation.report_step_id}`
      );
    }
  }
}

function validateDelta(delta: GraphDelta, graph: GraphView, errors: string[]) {
  const graphNodeIds = new Set(graph.nodes.map((nodeItem) => nodeItem.id));
  const graphEdgeIds = new Set(graph.edges.map((edgeItem) => edgeItem.id));
  if (delta.view_key !== graph.key) {
    errors.push(`delta ${delta.view_key} does not apply to graph ${graph.key}`);
  }
  if (delta.base_revision !== graph.revision) {
    errors.push(
      `delta ${delta.view_key} base revision ${delta.base_revision} does not match ${graph.revision}`
    );
  }
  if (delta.revision !== delta.base_revision + 1) {
    errors.push(`delta ${delta.view_key} revision must advance by one`);
  }
  for (const removedNode of delta.nodes_removed) {
    if (!graphNodeIds.has(removedNode)) {
      errors.push(
        `delta ${delta.view_key} removes unknown node ${removedNode}`
      );
    }
  }
  for (const removedEdge of delta.edges_removed) {
    if (!graphEdgeIds.has(removedEdge)) {
      errors.push(
        `delta ${delta.view_key} removes unknown edge ${removedEdge}`
      );
    }
  }
  const removedNodeSet = new Set(delta.nodes_removed);
  for (const edgeItem of delta.edges_added.concat(delta.edges_updated)) {
    if (removedNodeSet.has(edgeItem.from) || removedNodeSet.has(edgeItem.to)) {
      errors.push(
        `delta ${delta.view_key} keeps edge ${edgeItem.id} attached to a removed node`
      );
    }
  }
  const removedEdgeSet = new Set(delta.edges_removed);
  for (const edgeItem of delta.edges_added.concat(delta.edges_updated)) {
    if (removedEdgeSet.has(edgeItem.id)) {
      errors.push(
        `delta ${delta.view_key} both removes and upserts edge ${edgeItem.id}`
      );
    }
  }
}

function validateJournal(
  journal: readonly JournalEnvelope[],
  snapshot: Snapshot,
  errors: string[]
) {
  let previousId = 0;
  for (const event of journal) {
    if (event.id <= previousId) {
      errors.push(`journal event ${event.id} is not monotonic`);
    }
    previousId = event.id;
    if (event.kind === "graph_delta") {
      const { payload } = event;
      if (isGraphDelta(payload)) {
        validateDelta(payload, snapshot.graph, errors);
      } else {
        errors.push(
          `journal event ${event.id} graph_delta has wrong payload shape`
        );
      }
    }
  }
}

function validateErrorFixtures(
  errorsToCheck: readonly unknown[],
  errors: string[]
) {
  for (const [index, item] of errorsToCheck.entries()) {
    if (!isObject(item)) {
      errors.push(`error fixture ${index} is not an object`);
      continue;
    }
    const { error } = item;
    if (
      !isObject(error) ||
      typeof error.code !== "string" ||
      typeof error.message !== "string"
    ) {
      errors.push(`error fixture ${index} does not match ApiError`);
    }
  }
}

interface IdIndex {
  activities: Set<ActivityId>;
  artifacts: Set<EntityId>;
  people: Set<EntityId>;
  policies: Set<EntityId>;
  projects: Set<EntityId>;
  workflows: Set<EntityId>;
}

function collectIds(snapshot: Snapshot): IdIndex {
  return {
    activities: new Set(snapshot.kb.activities.map((activity) => activity.id)),
    artifacts: new Set(snapshot.kb.artifacts.map((artifact) => artifact.id)),
    people: new Set(snapshot.kb.people.map((person) => person.id)),
    policies: new Set(snapshot.kb.policies.map((policy) => policy.id)),
    projects: new Set(snapshot.kb.projects.map((project) => project.id)),
    workflows: new Set(snapshot.kb.workflows.map((workflow) => workflow.id)),
  };
}

function isGraphDelta(value: unknown): value is GraphDelta {
  return (
    isObject(value) &&
    typeof value.view_key === "string" &&
    typeof value.base_revision === "number" &&
    typeof value.revision === "number" &&
    Array.isArray(value.nodes_added) &&
    Array.isArray(value.nodes_updated) &&
    Array.isArray(value.nodes_removed) &&
    Array.isArray(value.edges_added) &&
    Array.isArray(value.edges_updated) &&
    Array.isArray(value.edges_removed)
  );
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
