export type StepState =
  | "abandoned"
  | "committed"
  | "done"
  | "failed"
  | "in_progress"
  | "requested"
  | "skipped";
export type StepStatus = "confirmed" | "proposed" | "rejected";
export type StepType =
  | "action"
  | "approval"
  | "decision"
  | "handoff"
  | "rework"
  | "wait";
export type SessionStatus = "closed" | "open";
export type PolicyKind = "approval" | "mandatory" | "ordering" | "threshold";
export type PolicyOutcome = "passed" | "pending" | "unknown" | "violation";
export type ThresholdMetric = "artifact_value" | "effort_days";

export interface WorkflowActivity {
  expectedRole?: string;
  label?: string;
  slug: string;
}

export interface DesignedWorkflow {
  activities: WorkflowActivity[];
  activitySlugs?: string[];
  id: string;
  matrix: number[][];
  projectId?: string;
}

export interface ConformanceSession {
  id: string;
  projectId?: string;
  status: SessionStatus;
  workflowId?: string | null;
}

export interface ConformanceStep {
  activitySlug: string;
  actorPersonId?: string | null;
  artifactId?: string | null;
  confidence?: number;
  effortDays?: number | null;
  evidence: string[];
  id: string;
  seq: number;
  sessionId: string;
  state: StepState;
  status: StepStatus;
  type: StepType;
}

export interface ConformancePerson {
  id: string;
  role: string;
}

export interface ConformanceArtifact {
  id: string;
  projectId?: string;
  unit?: string | null;
  value?: number | null;
}

export interface PolicyParams {
  after?: string;
  before?: string;
  limit?: number;
  metric?: ThresholdMetric;
  roles?: string[];
}

export interface ConformancePolicy {
  activitySlug: string;
  id: string;
  kind: PolicyKind;
  params?: PolicyParams;
  projectId?: string;
  text: string;
}

export interface EvidenceMessage {
  authorized: boolean;
  permalink?: string | null;
  quote?: string | null;
  ts: string;
}

export interface EvidenceCitation {
  messageTs: string;
  permalink: string;
  quote: string;
  stepId: string;
}

export interface OrderBreak {
  evidence: EvidenceCitation[];
  expectedBetween: string[];
  from: string;
  to: string;
}

export interface ControlFlowScore {
  extra: string[];
  fitness: number | null;
  missing: string[];
  observed: string[];
  orderBreaks: OrderBreak[];
  precision: number | null;
}

export interface PolicyCheckResult {
  evidence: EvidenceCitation[];
  outcome: PolicyOutcome;
  policyId: string;
  reason: string;
}

export interface RoleDeviation {
  activitySlug: string;
  actorPersonId: string;
  actorRole: string;
  adjustedConfidence?: number;
  evidence: EvidenceCitation[];
  expectedRole: string;
  stepId: string;
}

export interface ActivityRoleSummary {
  activitySlug: string;
  expectedRole?: string;
  rolesObserved: string[];
}

export interface CommitmentFinding {
  activitySlug: string;
  actorPersonId?: string | null;
  evidence: EvidenceCitation[];
  state: "abandoned" | "committed" | "in_progress" | "requested";
  stepId: string;
}

export interface GroundingScore {
  groundedRatio: number | null;
  groundedSteps: number;
  totalEvidenceBearingSteps: number;
}

export interface SessionConformanceResult {
  abandonedCommitments: CommitmentFinding[];
  controlFlow: ControlFlowScore;
  grounding: GroundingScore;
  policyResults: PolicyCheckResult[];
  roleDeviations: RoleDeviation[];
  roles: ActivityRoleSummary[];
  sessionId: string;
  status: SessionStatus;
  unreconciledCommitments: CommitmentFinding[];
  violations: PolicyCheckResult[];
}

export interface WorkflowRollup {
  closedSessions: number;
  extraCounts: Record<string, number>;
  fitness: number | null;
  grounding: GroundingScore;
  missingCounts: Record<string, number>;
  openSessions: number;
  policyOutcomeCounts: Record<PolicyOutcome, number>;
  precision: number | null;
  roleDeviationCount: number;
  sessions: number;
  violationCount: number;
}

export interface ConformanceInput {
  artifacts?: ConformanceArtifact[];
  evidence?: EvidenceMessage[];
  people: ConformancePerson[];
  policies: ConformancePolicy[];
  sessions: ConformanceSession[];
  steps: ConformanceStep[];
  workflow: DesignedWorkflow;
}

export interface ConformanceResult {
  rollup: WorkflowRollup;
  sessions: SessionConformanceResult[];
  workflowId: string;
}

type StepWithCitations = ConformanceStep & { citations: EvidenceCitation[] };

const OUTCOMES: PolicyOutcome[] = ["passed", "pending", "unknown", "violation"];

export function scoreConformance(input: ConformanceInput): ConformanceResult {
  const activitySlugs =
    input.workflow.activitySlugs ??
    input.workflow.activities.map((a) => a.slug);
  const evidenceByTs = new Map(input.evidence?.map((e) => [e.ts, e]));
  const stepsBySession = groupStepsBySession(input.steps, evidenceByTs);
  const peopleById = new Map(input.people.map((person) => [person.id, person]));
  const artifactsById = new Map(
    input.artifacts?.map((artifact) => [artifact.id, artifact]) ?? []
  );
  const expectedRoles = new Map(
    input.workflow.activities
      .filter((activity) => activity.expectedRole)
      .map((activity) => [activity.slug, activity.expectedRole ?? ""])
  );
  const sessions = input.sessions.map((session) =>
    scoreSession({
      activitySlugs,
      artifactsById,
      expectedRoles,
      peopleById,
      policies: input.policies.filter((policy) =>
        policyAppliesToSession(policy, session)
      ),
      session,
      steps: stepsBySession.get(session.id) ?? [],
      workflow: input.workflow,
    })
  );
  return {
    rollup: rollUpSessions(sessions),
    sessions,
    workflowId: input.workflow.id,
  };
}

function groupStepsBySession(
  steps: ConformanceStep[],
  evidenceByTs: Map<string, EvidenceMessage>
) {
  const grouped = new Map<string, StepWithCitations[]>();
  for (const step of steps) {
    const withCitations = {
      ...step,
      citations: citationsForStep(step, evidenceByTs),
    };
    grouped.set(step.sessionId, [
      ...(grouped.get(step.sessionId) ?? []),
      withCitations,
    ]);
  }
  for (const sessionSteps of grouped.values()) {
    sessionSteps.sort(
      (a, b) =>
        a.seq - b.seq ||
        a.activitySlug.localeCompare(b.activitySlug) ||
        a.id.localeCompare(b.id)
    );
  }
  return grouped;
}

function citationsForStep(
  step: ConformanceStep,
  evidenceByTs: Map<string, EvidenceMessage>
) {
  return step.evidence.flatMap((messageTs) => {
    const message = evidenceByTs.get(messageTs);
    if (!(message?.authorized && message.permalink && message.quote)) {
      return [];
    }
    return [
      {
        messageTs,
        permalink: message.permalink,
        quote: message.quote,
        stepId: step.id,
      },
    ];
  });
}

function policyAppliesToSession(
  policy: ConformancePolicy,
  session: ConformanceSession
) {
  return !(
    policy.projectId &&
    session.projectId &&
    policy.projectId !== session.projectId
  );
}

interface SessionScoreContext {
  activitySlugs: string[];
  artifactsById: Map<string, ConformanceArtifact>;
  expectedRoles: Map<string, string>;
  peopleById: Map<string, ConformancePerson>;
  policies: ConformancePolicy[];
  session: ConformanceSession;
  steps: StepWithCitations[];
  workflow: DesignedWorkflow;
}

function scoreSession(context: SessionScoreContext): SessionConformanceResult {
  const completedSteps = context.steps.filter(isCompletedAcceptedStep);
  const observed = unique(completedSteps.map((step) => step.activitySlug));
  const missing = context.activitySlugs.filter(
    (slug) => !observed.includes(slug)
  );
  const extra = observed.filter(
    (slug) => !context.activitySlugs.includes(slug)
  );
  const shared = observed.filter((slug) =>
    context.activitySlugs.includes(slug)
  );
  const roleDeviations = findRoleDeviations(context);
  const policyResults = context.policies.map((policy) =>
    evaluatePolicy(policy, context, completedSteps)
  );
  const commitments = findCommitments(context.steps);
  return {
    abandonedCommitments: commitments.filter(
      (finding) => finding.state === "abandoned"
    ),
    controlFlow: {
      extra,
      fitness: ratioOrNull(shared.length, context.activitySlugs.length),
      missing,
      observed,
      orderBreaks: findOrderBreaks(completedSteps, context.workflow),
      precision: ratioOrNull(shared.length, observed.length),
    },
    grounding: scoreGrounding(context.steps),
    policyResults,
    roleDeviations,
    roles: summarizeRoles(context, completedSteps),
    sessionId: context.session.id,
    status: context.session.status,
    unreconciledCommitments: commitments.filter(
      (finding) => finding.state !== "abandoned"
    ),
    violations: policyResults.filter(
      (result) => result.outcome === "violation"
    ),
  };
}

function isCompletedAcceptedStep(step: ConformanceStep) {
  return step.status === "confirmed" && step.state === "done";
}

function isNonRejectedStep(step: ConformanceStep) {
  return step.status !== "rejected";
}

function ratioOrNull(numerator: number, denominator: number) {
  return denominator === 0 ? null : numerator / denominator;
}

function unique(values: string[]) {
  return [...new Set(values)];
}

function findOrderBreaks(
  steps: StepWithCitations[],
  workflow: DesignedWorkflow
) {
  const activitySlugs =
    workflow.activitySlugs ??
    workflow.activities.map((activity) => activity.slug);
  const indexBySlug = new Map(
    activitySlugs.map((slug, index) => [slug, index])
  );
  const breaks: OrderBreak[] = [];
  for (let index = 0; index < steps.length - 1; index += 1) {
    const current = steps[index];
    const next = steps[index + 1];
    if (!(current && next)) {
      continue;
    }
    const fromIndex = indexBySlug.get(current.activitySlug);
    const toIndex = indexBySlug.get(next.activitySlug);
    if (fromIndex === undefined || toIndex === undefined) {
      continue;
    }
    if ((workflow.matrix[fromIndex]?.[toIndex] ?? 0) > 0) {
      continue;
    }
    breaks.push({
      evidence: [...current.citations, ...next.citations],
      expectedBetween: expectedBetween(
        fromIndex,
        toIndex,
        workflow.matrix,
        activitySlugs
      ),
      from: current.activitySlug,
      to: next.activitySlug,
    });
  }
  return breaks;
}

function expectedBetween(
  fromIndex: number,
  toIndex: number,
  matrix: number[][],
  activitySlugs: string[]
) {
  const queue: { index: number; path: number[] }[] = [
    { index: fromIndex, path: [] },
  ];
  const visited = new Set<number>([fromIndex]);
  while (queue.length) {
    const current = queue.shift();
    if (!current) {
      continue;
    }
    const row = matrix[current.index] ?? [];
    for (let nextIndex = 0; nextIndex < row.length; nextIndex += 1) {
      if ((row[nextIndex] ?? 0) <= 0 || visited.has(nextIndex)) {
        continue;
      }
      const path = [...current.path, nextIndex];
      if (nextIndex === toIndex) {
        return path
          .slice(0, -1)
          .map((index) => activitySlugs[index])
          .filter((slug): slug is string => Boolean(slug));
      }
      visited.add(nextIndex);
      queue.push({ index: nextIndex, path });
    }
  }
  return [];
}

function evaluatePolicy(
  policy: ConformancePolicy,
  context: SessionScoreContext,
  completedSteps: StepWithCitations[]
): PolicyCheckResult {
  switch (policy.kind) {
    case "mandatory":
      return evaluateMandatoryPolicy(policy, context, completedSteps);
    case "ordering":
      return evaluateOrderingPolicy(policy, context, completedSteps);
    case "approval":
      return evaluateApprovalPolicy(policy, context, completedSteps);
    case "threshold":
      return evaluateThresholdPolicy(policy, context, completedSteps);
    default:
      return policyResult(policy, "unknown", "policy_kind_unknown", []);
  }
}

function evaluateMandatoryPolicy(
  policy: ConformancePolicy,
  context: SessionScoreContext,
  completedSteps: StepWithCitations[]
) {
  const completed = firstActivityStep(completedSteps, policy.activitySlug);
  if (completed) {
    return policyResult(policy, "passed", "completed", completed.citations);
  }
  const skipped = firstSkippedStep(context.steps, policy.activitySlug);
  if (skipped) {
    return violationOrUnknown(policy, "explicit_skip", skipped.citations);
  }
  if (context.session.status === "open") {
    return policyResult(policy, "pending", "case_open", []);
  }
  return violationOrUnknown(
    policy,
    "mandatory_missing_on_closed_case",
    lastCitations(completedSteps)
  );
}

function evaluateOrderingPolicy(
  policy: ConformancePolicy,
  context: SessionScoreContext,
  completedSteps: StepWithCitations[]
) {
  const beforeSlug = policy.params?.before;
  const afterSlug = policy.params?.after;
  if (!(beforeSlug && afterSlug)) {
    return policyResult(policy, "unknown", "ordering_params_missing", []);
  }
  const skipped = firstSkippedStep(context.steps, beforeSlug);
  if (skipped) {
    return violationOrUnknown(policy, "explicit_skip", skipped.citations);
  }
  const before = firstActivityStep(completedSteps, beforeSlug);
  const after = firstActivityStep(completedSteps, afterSlug);
  if (!after) {
    return context.session.status === "open"
      ? policyResult(policy, "pending", "downstream_activity_not_observed", [])
      : policyResult(policy, "passed", "downstream_activity_not_observed", []);
  }
  if (!before || before.seq > after.seq) {
    return violationOrUnknown(policy, "order_breach", [
      ...(before?.citations ?? []),
      ...after.citations,
    ]);
  }
  return policyResult(policy, "passed", "ordered", [
    ...before.citations,
    ...after.citations,
  ]);
}

function evaluateApprovalPolicy(
  policy: ConformancePolicy,
  context: SessionScoreContext,
  completedSteps: StepWithCitations[]
) {
  const triggerSlug = policy.params?.after;
  const roles = policy.params?.roles ?? [];
  if (!(triggerSlug && roles.length)) {
    return policyResult(policy, "unknown", "approval_params_missing", []);
  }
  const skipped = firstSkippedStep(context.steps, policy.activitySlug);
  if (skipped) {
    return violationOrUnknown(policy, "explicit_skip", skipped.citations);
  }
  const trigger = firstActivityStep(completedSteps, triggerSlug);
  if (!trigger) {
    return context.session.status === "open"
      ? policyResult(policy, "pending", "trigger_not_observed", [])
      : policyResult(policy, "unknown", "trigger_not_observed", []);
  }
  const approval = findApprovalAfter(
    completedSteps,
    trigger.seq,
    { activitySlug: policy.activitySlug, roles },
    context.peopleById
  );
  if (approval) {
    return policyResult(policy, "passed", "approved", approval.citations);
  }
  return context.session.status === "open"
    ? policyResult(policy, "pending", "approval_pending", trigger.citations)
    : violationOrUnknown(
        policy,
        "approval_missing_on_closed_case",
        trigger.citations
      );
}

function evaluateThresholdPolicy(
  policy: ConformancePolicy,
  context: SessionScoreContext,
  completedSteps: StepWithCitations[]
) {
  const limit = policy.params?.limit;
  const roles = policy.params?.roles ?? [];
  if (!(typeof limit === "number" && roles.length)) {
    return policyResult(policy, "unknown", "threshold_params_missing", []);
  }
  const metric = policy.params?.metric ?? "artifact_value";
  const measured = thresholdMeasurements(
    metric,
    completedSteps,
    context.artifactsById
  );
  if (measured.length === 0) {
    return policyResult(policy, "unknown", "threshold_value_unknown", []);
  }
  const breached = measured.filter((measurement) => measurement.value > limit);
  if (breached.length === 0) {
    return policyResult(policy, "passed", "below_threshold", []);
  }
  const [firstBreach] = breached as [
    (typeof breached)[number],
    ...typeof breached,
  ];
  const approval = findApprovalAfter(
    completedSteps,
    firstBreach.step.seq,
    { roles },
    context.peopleById
  );
  if (approval) {
    return policyResult(policy, "passed", "approved", approval.citations);
  }
  return context.session.status === "open"
    ? policyResult(
        policy,
        "pending",
        "approval_pending",
        firstBreach.step.citations
      )
    : violationOrUnknown(
        policy,
        "threshold_approval_missing_on_closed_case",
        firstBreach.step.citations
      );
}

function thresholdMeasurements(
  metric: ThresholdMetric,
  steps: StepWithCitations[],
  artifactsById: Map<string, ConformanceArtifact>
) {
  return steps.flatMap((step) => {
    if (metric === "effort_days") {
      return typeof step.effortDays === "number"
        ? [{ step, value: step.effortDays }]
        : [];
    }
    const artifact = step.artifactId
      ? artifactsById.get(step.artifactId)
      : undefined;
    return typeof artifact?.value === "number"
      ? [{ step, value: artifact.value }]
      : [];
  });
}

function firstActivityStep(steps: StepWithCitations[], activitySlug: string) {
  return steps.find((step) => step.activitySlug === activitySlug);
}

function firstSkippedStep(steps: StepWithCitations[], activitySlug: string) {
  return steps.find(
    (step) =>
      step.activitySlug === activitySlug &&
      step.state === "skipped" &&
      isNonRejectedStep(step)
  );
}

function findApprovalAfter(
  steps: StepWithCitations[],
  triggerSeq: number,
  criteria: { activitySlug?: string; roles: string[] },
  peopleById: Map<string, ConformancePerson>
) {
  return steps.find((step) => {
    const actorRole = step.actorPersonId
      ? peopleById.get(step.actorPersonId)?.role
      : undefined;
    return (
      step.seq > triggerSeq &&
      (criteria.activitySlug === undefined ||
        step.activitySlug === criteria.activitySlug) &&
      step.type === "approval" &&
      Boolean(actorRole && criteria.roles.includes(actorRole))
    );
  });
}

function lastCitations(steps: StepWithCitations[]) {
  return steps.at(-1)?.citations ?? [];
}

function policyResult(
  policy: ConformancePolicy,
  outcome: PolicyOutcome,
  reason: string,
  evidence: EvidenceCitation[]
): PolicyCheckResult {
  return {
    evidence,
    outcome,
    policyId: policy.id,
    reason,
  };
}

function violationOrUnknown(
  policy: ConformancePolicy,
  reason: string,
  evidence: EvidenceCitation[]
) {
  return evidence.length
    ? policyResult(policy, "violation", reason, evidence)
    : policyResult(policy, "unknown", "unresolved_evidence", []);
}

function findRoleDeviations(context: SessionScoreContext) {
  return context.steps.flatMap((step) => {
    if (!isNonRejectedStep(step)) {
      return [];
    }
    const expectedRole = context.expectedRoles.get(step.activitySlug);
    const actor = step.actorPersonId
      ? context.peopleById.get(step.actorPersonId)
      : undefined;
    if (!(expectedRole && actor && actor.role !== expectedRole)) {
      return [];
    }
    return [
      {
        activitySlug: step.activitySlug,
        actorPersonId: actor.id,
        actorRole: actor.role,
        adjustedConfidence: confidencePenalty(step),
        evidence: step.citations,
        expectedRole,
        stepId: step.id,
      },
    ];
  });
}

function confidencePenalty(step: ConformanceStep) {
  const confidence = "confidence" in step ? step.confidence : undefined;
  return typeof confidence === "number" ? confidence * 0.8 : undefined;
}

function summarizeRoles(
  context: SessionScoreContext,
  completedSteps: ConformanceStep[]
) {
  return context.workflow.activities.map((activity) => {
    const rolesObserved = unique(
      completedSteps
        .filter((step) => step.activitySlug === activity.slug)
        .flatMap((step) => {
          const actor = step.actorPersonId
            ? context.peopleById.get(step.actorPersonId)
            : undefined;
          return actor ? [actor.role] : [];
        })
    ).sort();
    return {
      activitySlug: activity.slug,
      expectedRole: activity.expectedRole,
      rolesObserved,
    };
  });
}

function findCommitments(steps: StepWithCitations[]) {
  return steps.flatMap((step): CommitmentFinding[] => {
    if (step.status === "rejected") {
      return [];
    }
    if (
      step.state !== "abandoned" &&
      step.state !== "committed" &&
      step.state !== "in_progress" &&
      step.state !== "requested"
    ) {
      return [];
    }
    return [
      {
        activitySlug: step.activitySlug,
        actorPersonId: step.actorPersonId,
        evidence: step.citations,
        state: step.state,
        stepId: step.id,
      },
    ];
  });
}

function scoreGrounding(steps: StepWithCitations[]): GroundingScore {
  const evidenceBearingSteps = steps.filter(
    (step) => step.status !== "rejected" && step.evidence.length > 0
  );
  const groundedSteps = evidenceBearingSteps.filter(
    (step) => step.citations.length > 0
  ).length;
  return {
    groundedRatio: ratioOrNull(groundedSteps, evidenceBearingSteps.length),
    groundedSteps,
    totalEvidenceBearingSteps: evidenceBearingSteps.length,
  };
}

function rollUpSessions(sessions: SessionConformanceResult[]): WorkflowRollup {
  const closedSessions = sessions.filter(
    (session) => session.status === "closed"
  );
  const policyOutcomeCounts = Object.fromEntries(
    OUTCOMES.map((outcome) => [outcome, 0])
  ) as Record<PolicyOutcome, number>;
  for (const session of sessions) {
    for (const result of session.policyResults) {
      policyOutcomeCounts[result.outcome] += 1;
    }
  }
  return {
    closedSessions: closedSessions.length,
    extraCounts: countSlugs(
      closedSessions.flatMap((session) => session.controlFlow.extra)
    ),
    fitness: averageNullable(
      closedSessions.map((session) => session.controlFlow.fitness)
    ),
    grounding: rollUpGrounding(closedSessions),
    missingCounts: countSlugs(
      closedSessions.flatMap((session) => session.controlFlow.missing)
    ),
    openSessions: sessions.length - closedSessions.length,
    policyOutcomeCounts,
    precision: averageNullable(
      closedSessions.map((session) => session.controlFlow.precision)
    ),
    roleDeviationCount: sessions.reduce(
      (sum, session) => sum + session.roleDeviations.length,
      0
    ),
    sessions: sessions.length,
    violationCount: sessions.reduce(
      (sum, session) => sum + session.violations.length,
      0
    ),
  };
}

function averageNullable(values: (number | null)[]) {
  const numbers = values.filter((value): value is number => value !== null);
  return ratioOrNull(
    numbers.reduce((sum, value) => sum + value, 0),
    numbers.length
  );
}

function countSlugs(slugs: string[]) {
  return slugs.reduce<Record<string, number>>((counts, slug) => {
    counts[slug] = (counts[slug] ?? 0) + 1;
    return counts;
  }, {});
}

function rollUpGrounding(sessions: SessionConformanceResult[]): GroundingScore {
  const totalEvidenceBearingSteps = sessions.reduce(
    (sum, session) => sum + session.grounding.totalEvidenceBearingSteps,
    0
  );
  const groundedSteps = sessions.reduce(
    (sum, session) => sum + session.grounding.groundedSteps,
    0
  );
  return {
    groundedRatio: ratioOrNull(groundedSteps, totalEvidenceBearingSteps),
    groundedSteps,
    totalEvidenceBearingSteps,
  };
}
