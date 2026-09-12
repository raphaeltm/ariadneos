import { describe, expect, it } from "vitest";
import {
  type ConformanceArtifact,
  type ConformanceInput,
  type ConformancePolicy,
  type ConformanceStep,
  type DesignedWorkflow,
  scoreConformance,
} from "../shared/mining/conformance.ts";

const workflow: DesignedWorkflow = {
  activities: [
    { expectedRole: "support", slug: "detect_incident" },
    { expectedRole: "support", slug: "triage_incident" },
    { expectedRole: "support", slug: "open_incident_ticket" },
    { expectedRole: "pm", slug: "assign_owner" },
    { expectedRole: "eng", slug: "reproduce_issue" },
    { expectedRole: "eng", slug: "root_cause_analysis" },
    { expectedRole: "eng", slug: "security_review" },
    { expectedRole: "eng", slug: "deploy_fix" },
    { expectedRole: "support", slug: "verify_resolution" },
    { expectedRole: "pm", slug: "notify_customer" },
    { expectedRole: "pmo", slug: "write_postmortem" },
  ],
  id: "wf_p1_incident",
  matrix: [
    [0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0],
    [0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0],
    [0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0],
    [0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0],
    [0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0],
    [0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0],
    [0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0],
    [0, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0],
    [0, 0, 0, 0, 0.3, 0, 0, 0, 0, 1, 0],
    [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1],
    [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
  ],
  projectId: "proj_helios",
};

const policies: ConformancePolicy[] = [
  {
    activitySlug: "security_review",
    id: "pol_sec_review",
    kind: "ordering",
    params: { after: "deploy_fix", before: "security_review" },
    projectId: "proj_helios",
    text: "A security review must complete before any production deploy.",
  },
  {
    activitySlug: "write_postmortem",
    id: "pol_postmortem",
    kind: "mandatory",
    projectId: "proj_helios",
    text: "Every P1 requires a written postmortem.",
  },
  {
    activitySlug: "issue_service_credit",
    id: "pol_credit_approval",
    kind: "threshold",
    params: { limit: 10_000, roles: ["cpo", "ceo"] },
    projectId: "proj_helios",
    text: "Service credits above EUR 10,000 require CPO or CEO approval.",
  },
];

const people = [
  { id: "per_priya", role: "support" },
  { id: "per_tom", role: "eng" },
  { id: "per_marc", role: "pm" },
  { id: "per_dana", role: "ceo" },
  { id: "per_lea", role: "pmo" },
];

const artifacts: ConformanceArtifact[] = [
  { id: "art_inc_4412", projectId: "proj_helios" },
  {
    id: "art_credit_high",
    projectId: "proj_helios",
    unit: "EUR",
    value: 15_000,
  },
  { id: "art_credit_unknown", projectId: "proj_helios", unit: "EUR" },
];

function evidence(ts: string) {
  return {
    authorized: true,
    permalink: `https://slack.example/archives/C1/p${ts.replace(".", "")}`,
    quote: `message ${ts}`,
    ts,
  };
}

function step(
  sessionId: string,
  seq: number,
  activitySlug: string,
  actorPersonId: string,
  options: Partial<ConformanceStep> = {}
): ConformanceStep {
  const id = `${sessionId}-${seq}-${activitySlug}`;
  return {
    activitySlug,
    actorPersonId,
    artifactId: "art_inc_4412",
    evidence: [`${seq}.000000`],
    id,
    seq,
    sessionId,
    state: "done",
    status: "confirmed",
    type: "action",
    ...options,
  };
}

function baseInput(
  overrides: Partial<ConformanceInput> = {}
): ConformanceInput {
  const steps = overrides.steps ?? [];
  return {
    artifacts,
    evidence: steps.flatMap((item) => item.evidence.map(evidence)),
    people,
    policies,
    sessions: overrides.sessions ?? [
      {
        id: "ses_1",
        projectId: "proj_helios",
        status: "closed",
        workflowId: "wf_p1_incident",
      },
    ],
    steps,
    workflow,
    ...overrides,
  };
}

describe("workflow conformance scoring", () => {
  it("scores a textbook closed incident as fully conformant", () => {
    const steps = [
      step("ses_1", 1, "detect_incident", "per_priya"),
      step("ses_1", 2, "triage_incident", "per_priya"),
      step("ses_1", 3, "open_incident_ticket", "per_priya"),
      step("ses_1", 4, "assign_owner", "per_marc", { type: "handoff" }),
      step("ses_1", 5, "reproduce_issue", "per_tom"),
      step("ses_1", 6, "root_cause_analysis", "per_tom"),
      step("ses_1", 7, "security_review", "per_tom"),
      step("ses_1", 8, "deploy_fix", "per_tom"),
      step("ses_1", 9, "verify_resolution", "per_priya"),
      step("ses_1", 10, "notify_customer", "per_marc"),
      step("ses_1", 11, "write_postmortem", "per_lea"),
    ];
    const [result] = scoreConformance(baseInput({ steps })).sessions;
    expect(result?.controlFlow.fitness).toBe(1);
    expect(result?.controlFlow.precision).toBe(1);
    expect(result?.controlFlow.orderBreaks).toEqual([]);
    expect(result?.violations).toEqual([]);
    expect(result?.grounding.groundedRatio).toBe(1);
  });

  it("detects skipped review, extra hotfix work, order breaks, and role deviations with evidence", () => {
    const steps = [
      step("ses_1", 1, "detect_incident", "per_priya"),
      step("ses_1", 2, "triage_incident", "per_priya"),
      step("ses_1", 3, "open_incident_ticket", "per_priya"),
      step("ses_1", 4, "assign_owner", "per_dana", {
        confidence: 0.9,
        type: "handoff",
      }),
      step("ses_1", 5, "security_review", "per_tom", {
        state: "skipped",
        type: "decision",
      }),
      step("ses_1", 6, "deploy_fix", "per_tom"),
      step("ses_1", 7, "improvise_hotfix", "per_tom"),
      step("ses_1", 8, "verify_resolution", "per_priya"),
      step("ses_1", 9, "notify_customer", "per_marc"),
      step("ses_1", 10, "write_postmortem", "per_lea"),
    ];
    const [result] = scoreConformance(baseInput({ steps })).sessions;
    expect(result?.controlFlow.missing).toContain("security_review");
    expect(result?.controlFlow.extra).toEqual(["improvise_hotfix"]);
    expect(result?.controlFlow.orderBreaks).toEqual([
      {
        evidence: expect.any(Array),
        expectedBetween: [
          "reproduce_issue",
          "root_cause_analysis",
          "security_review",
        ],
        from: "assign_owner",
        to: "deploy_fix",
      },
    ]);
    expect(result?.violations.map((violation) => violation.policyId)).toContain(
      "pol_sec_review"
    );
    expect(result?.violations[0]?.evidence[0]).toMatchObject({
      messageTs: "5.000000",
      quote: "message 5.000000",
      stepId: "ses_1-5-security_review",
    });
    expect(result?.roleDeviations).toEqual([
      {
        activitySlug: "assign_owner",
        actorPersonId: "per_dana",
        actorRole: "ceo",
        adjustedConfidence: 0.720_000_000_000_000_1,
        evidence: expect.any(Array),
        expectedRole: "pm",
        stepId: "ses_1-4-assign_owner",
      },
    ]);
  });

  it("keeps open cases pending until downstream breach or explicit skip", () => {
    const steps = [
      step("ses_open", 1, "detect_incident", "per_priya"),
      step("ses_open", 2, "triage_incident", "per_priya"),
    ];
    const [result] = scoreConformance(
      baseInput({
        sessions: [
          {
            id: "ses_open",
            projectId: "proj_helios",
            status: "open",
            workflowId: "wf_p1_incident",
          },
        ],
        steps,
      })
    ).sessions;
    expect(result?.violations).toEqual([]);
    expect(
      result?.policyResults.find(
        (policy) => policy.policyId === "pol_postmortem"
      )?.outcome
    ).toBe("pending");
    expect(
      result?.policyResults.find(
        (policy) => policy.policyId === "pol_sec_review"
      )?.outcome
    ).toBe("pending");
  });

  it("tracks unreconciled and abandoned commitments outside the discovered graph", () => {
    const steps = [
      step("ses_1", 1, "detect_incident", "per_priya"),
      step("ses_1", 2, "deploy_fix", "per_tom", {
        state: "committed",
      }),
      step("ses_1", 3, "write_postmortem", "per_lea", {
        state: "abandoned",
      }),
    ];
    const [result] = scoreConformance(baseInput({ steps })).sessions;
    expect(result?.controlFlow.observed).toEqual(["detect_incident"]);
    expect(result?.unreconciledCommitments).toEqual([
      expect.objectContaining({
        activitySlug: "deploy_fix",
        state: "committed",
      }),
    ]);
    expect(result?.abandonedCommitments).toEqual([
      expect.objectContaining({
        activitySlug: "write_postmortem",
        state: "abandoned",
      }),
    ]);
  });

  it("accepts designed rework loops without turning them into order breaks", () => {
    const steps = [
      step("ses_1", 1, "detect_incident", "per_priya"),
      step("ses_1", 2, "triage_incident", "per_priya"),
      step("ses_1", 3, "open_incident_ticket", "per_priya"),
      step("ses_1", 4, "assign_owner", "per_marc", { type: "handoff" }),
      step("ses_1", 5, "reproduce_issue", "per_tom"),
      step("ses_1", 6, "root_cause_analysis", "per_tom"),
      step("ses_1", 7, "security_review", "per_tom"),
      step("ses_1", 8, "deploy_fix", "per_tom"),
      step("ses_1", 9, "verify_resolution", "per_priya"),
      step("ses_1", 10, "reproduce_issue", "per_tom", { type: "rework" }),
      step("ses_1", 11, "root_cause_analysis", "per_tom", { type: "rework" }),
      step("ses_1", 12, "security_review", "per_tom"),
      step("ses_1", 13, "deploy_fix", "per_tom"),
      step("ses_1", 14, "verify_resolution", "per_priya"),
      step("ses_1", 15, "notify_customer", "per_marc"),
      step("ses_1", 16, "write_postmortem", "per_lea"),
    ];
    const [result] = scoreConformance(baseInput({ steps })).sessions;
    expect(result?.controlFlow.orderBreaks).toEqual([]);
    expect(result?.controlFlow.precision).toBe(1);
    expect(result?.violations).toEqual([]);
  });
});

describe("policy evidence and rollups", () => {
  it("evaluates approval policies across passed, pending, and closed violation states", () => {
    const approvalPolicy: ConformancePolicy = {
      activitySlug: "exec_approval",
      id: "pol_exec_approval",
      kind: "approval",
      params: { after: "estimate_effort", roles: ["ceo"] },
      projectId: "proj_helios",
      text: "Large estimates require CEO approval.",
    };
    const passedSteps = [
      step("ses_1", 1, "estimate_effort", "per_tom"),
      step("ses_1", 2, "exec_approval", "per_dana", { type: "approval" }),
      step("ses_1", 3, "write_postmortem", "per_lea"),
    ];
    const [passed] = scoreConformance(
      baseInput({ policies: [approvalPolicy], steps: passedSteps })
    ).sessions;
    expect(passed?.policyResults[0]).toMatchObject({
      outcome: "passed",
      reason: "approved",
    });

    const pendingSteps = [step("ses_open", 1, "estimate_effort", "per_tom")];
    const [pending] = scoreConformance(
      baseInput({
        policies: [approvalPolicy],
        sessions: [
          {
            id: "ses_open",
            projectId: "proj_helios",
            status: "open",
            workflowId: "wf_p1_incident",
          },
        ],
        steps: pendingSteps,
      })
    ).sessions;
    expect(pending?.policyResults[0]).toMatchObject({
      outcome: "pending",
      reason: "approval_pending",
    });

    const [violated] = scoreConformance(
      baseInput({
        policies: [approvalPolicy],
        steps: [step("ses_1", 1, "estimate_effort", "per_tom")],
      })
    ).sessions;
    expect(violated?.policyResults[0]).toMatchObject({
      outcome: "violation",
      reason: "approval_missing_on_closed_case",
    });
  });

  it("reports threshold approval violations only when numeric values are known", () => {
    const steps = [
      step("ses_1", 1, "issue_service_credit", "per_marc", {
        artifactId: "art_credit_high",
      }),
      step("ses_1", 2, "write_postmortem", "per_lea"),
    ];
    const [result] = scoreConformance(baseInput({ steps })).sessions;
    expect(
      result?.policyResults.find(
        (policy) => policy.policyId === "pol_credit_approval"
      )
    ).toMatchObject({
      outcome: "violation",
      reason: "threshold_approval_missing_on_closed_case",
    });

    const [unknown] = scoreConformance(
      baseInput({
        steps: [
          step("ses_1", 1, "issue_service_credit", "per_marc", {
            artifactId: "art_credit_unknown",
          }),
          step("ses_1", 2, "write_postmortem", "per_lea"),
        ],
      })
    ).sessions;
    expect(
      unknown?.policyResults.find(
        (policy) => policy.policyId === "pol_credit_approval"
      )
    ).toMatchObject({
      outcome: "unknown",
      reason: "threshold_value_unknown",
    });
  });

  it("handles below-threshold, approved, pending, and effort-based thresholds", () => {
    const effortPolicy: ConformancePolicy = {
      activitySlug: "estimate_effort",
      id: "pol_effort_threshold",
      kind: "threshold",
      params: { limit: 20, metric: "effort_days", roles: ["ceo"] },
      projectId: "proj_helios",
      text: "Large effort needs CEO approval.",
    };
    const [below] = scoreConformance(
      baseInput({
        policies: [effortPolicy],
        steps: [
          step("ses_1", 1, "estimate_effort", "per_tom", { effortDays: 8 }),
        ],
      })
    ).sessions;
    expect(below?.policyResults[0]).toMatchObject({
      outcome: "passed",
      reason: "below_threshold",
    });

    const [approved] = scoreConformance(
      baseInput({
        policies: [effortPolicy],
        steps: [
          step("ses_1", 1, "estimate_effort", "per_tom", { effortDays: 25 }),
          step("ses_1", 2, "exec_approval", "per_dana", { type: "approval" }),
        ],
      })
    ).sessions;
    expect(approved?.policyResults[0]).toMatchObject({
      outcome: "passed",
      reason: "approved",
    });

    const [pending] = scoreConformance(
      baseInput({
        policies: [effortPolicy],
        sessions: [
          {
            id: "ses_open",
            projectId: "proj_helios",
            status: "open",
            workflowId: "wf_p1_incident",
          },
        ],
        steps: [
          step("ses_open", 1, "estimate_effort", "per_tom", {
            effortDays: 25,
          }),
        ],
      })
    ).sessions;
    expect(pending?.policyResults[0]).toMatchObject({
      outcome: "pending",
      reason: "approval_pending",
    });
  });

  it("does not emit an uncited violation when evidence is unauthorized", () => {
    const skippedReview = step("ses_1", 1, "security_review", "per_tom", {
      state: "skipped",
    });
    const [result] = scoreConformance(
      baseInput({
        evidence: [
          {
            authorized: false,
            permalink: "https://slack.example/archives/C1/p1000000",
            quote: "skipping review",
            ts: "1.000000",
          },
        ],
        steps: [skippedReview],
      })
    ).sessions;
    expect(result?.violations).toEqual([]);
    expect(
      result?.policyResults.find(
        (policy) => policy.policyId === "pol_sec_review"
      )
    ).toMatchObject({
      evidence: [],
      outcome: "unknown",
      reason: "unresolved_evidence",
    });
  });

  it("ignores rejected steps for commitments, role deviations, and grounding", () => {
    const steps = [
      step("ses_1", 1, "assign_owner", "per_dana", {
        state: "requested",
        status: "rejected",
      }),
    ];
    const [result] = scoreConformance(baseInput({ steps })).sessions;
    expect(result?.abandonedCommitments).toEqual([]);
    expect(result?.roleDeviations).toEqual([]);
    expect(result?.grounding).toEqual({
      groundedRatio: null,
      groundedSteps: 0,
      totalEvidenceBearingSteps: 0,
    });
  });

  it("rolls up only closed-session conformance scores and preserves null denominators", () => {
    const emptyWorkflow: DesignedWorkflow = {
      activities: [],
      id: "wf_empty",
      matrix: [],
    };
    const result = scoreConformance({
      people,
      policies: [],
      sessions: [
        { id: "ses_closed", status: "closed" },
        { id: "ses_open", status: "open" },
      ],
      steps: [],
      workflow: emptyWorkflow,
    });
    expect(result.sessions[0]?.controlFlow.fitness).toBeNull();
    expect(result.sessions[0]?.controlFlow.precision).toBeNull();
    expect(result.rollup).toMatchObject({
      closedSessions: 1,
      fitness: null,
      openSessions: 1,
      precision: null,
      sessions: 2,
    });
  });
});
