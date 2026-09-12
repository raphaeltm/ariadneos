import type {
  Activity,
  ApiError,
  Artifact,
  ArtifactLifecycleDefinition,
  Citation,
  Command,
  EvidenceRef,
  GraphDelta,
  GraphEdge,
  GraphNode,
  GraphView,
  JournalEnvelope,
  KnowledgeBase,
  Message,
  Person,
  Policy,
  ProcessSession,
  PromiseReportReconciliation,
  Role,
  RoleRepertoire,
  SessionConformance,
  Snapshot,
  Step,
  Workflow,
  WorkflowActivity,
} from "./contracts.ts";

const workspace_id = "T_SYNTH_FIXTURE";
const channel = "C_SYNTH_PROCESS";

const evidence = (
  _session_id: ProcessSession["id"],
  ts: Message["ts"],
  revision = 1
): EvidenceRef => ({
  channel,
  message_id: `${workspace_id}:${channel}:${ts}`,
  message_revision: revision,
  ts,
  workspace_id,
});

export const fixtureRoles: Role[] = [
  { id: "support", name: "Support" },
  { id: "eng", name: "Engineering" },
  { id: "pm", name: "Product management" },
  { id: "cpo", name: "Chief product officer" },
  { id: "ceo", name: "Chief executive officer" },
  { id: "pmo", name: "Program management" },
];

export const fixturePeople: Person[] = [
  {
    biases: ["Escalates quickly when SLA credits are at risk"],
    color: "#E8B84B",
    comms_style: "Short, factual, timestamps decisions.",
    emoji: ":woman_firefighter:",
    goals: ["Protect enterprise checkout uptime"],
    id: "per_priya",
    name: "Priya Raman",
    project_ids: ["proj_helios"],
    role: "support",
    seniority: "lead",
  },
  {
    biases: ["Prefers correctness over speed"],
    color: "#38BDF8",
    comms_style: "Specific, technical, names risk plainly.",
    emoji: ":man_technologist:",
    goals: ["Keep production changes reviewable"],
    id: "per_tom",
    name: "Tom Becker",
    project_ids: ["proj_helios"],
    role: "eng",
    seniority: "staff",
  },
  {
    biases: ["Trades scope to hold dates"],
    color: "#A78BFA",
    comms_style: "Customer-facing and pragmatic.",
    emoji: ":man_office_worker:",
    goals: ["Keep commitments clear"],
    id: "per_marc",
    name: "Marc Delacroix",
    project_ids: ["proj_helios", "proj_atlas"],
    role: "pm",
    seniority: "senior",
  },
  {
    biases: ["Protects roadmap integrity"],
    color: "#F472B6",
    comms_style: "Crisp decisions with context.",
    emoji: ":woman_judge:",
    goals: ["Defend Q4 focus"],
    id: "per_sofia",
    name: "Sofia Lindqvist",
    project_ids: ["proj_atlas"],
    role: "cpo",
    seniority: "executive",
  },
  {
    biases: ["Escalates around slow process for strategic accounts"],
    color: "#F87171",
    comms_style: "Direct, terse, outcome-first.",
    emoji: ":woman_in_tuxedo:",
    goals: ["Retain Vertex"],
    id: "per_dana",
    name: "Dana Okafor",
    project_ids: ["proj_helios", "proj_atlas"],
    role: "ceo",
    seniority: "executive",
  },
  {
    biases: ["Asks for written proof"],
    color: "#4ADE80",
    comms_style: "Process-focused and careful.",
    emoji: ":woman_teacher:",
    goals: ["Make work auditable"],
    id: "per_lea",
    name: "Lea Moreau",
    project_ids: ["proj_helios"],
    role: "pmo",
    seniority: "manager",
  },
];

export const fixtureProjects = [
  {
    constraints: [
      "Any production deploy requires a security review.",
      "Customer credits above 10000 require executive approval.",
    ],
    id: "proj_helios",
    name: "Helios Payments",
    spec_md:
      "Synthetic fixture project for enterprise checkout incidents. Vertex is the customer account, not a project.",
    summary: "Checkout and payment orchestration for enterprise merchants.",
    workflow_id: "wf_p1_incident",
  },
  {
    constraints: [
      "Roadmap changes require CPO review before the roadmap is updated.",
      "Requests above 20 engineer-days require CEO approval.",
    ],
    id: "proj_atlas",
    name: "Atlas Self-Serve Billing",
    spec_md: "Synthetic fixture project for SMB billing feature intake.",
    summary: "Self-serve billing and plan management for the SMB tier.",
    workflow_id: "wf_feature_intake",
  },
] satisfies KnowledgeBase["projects"];

export const fixtureArtifacts: Artifact[] = [
  {
    current_state: "resolved",
    id: "art_inc_4412",
    name: "INC-4412 Vertex checkout 500s",
    project_id: "proj_helios",
    type: "incident",
    uri: "https://synthetic.invalid/status/INC-4412",
  },
  {
    id: "art_sec_checklist",
    name: "Pre-deploy security checklist",
    project_id: "proj_helios",
    type: "doc",
    uri: "https://synthetic.invalid/docs/security-checklist",
  },
  {
    current_state: "approved",
    id: "art_credit_vertex",
    name: "Vertex service credit request",
    project_id: "proj_helios",
    type: "ticket",
    unit: "USD",
    value: 12_500,
  },
  {
    current_state: "scheduled",
    id: "art_req_vertex_sso",
    name: "REQ-88 Vertex SSO for billing portal",
    project_id: "proj_atlas",
    type: "ticket",
    uri: "https://synthetic.invalid/tickets/REQ-88",
  },
  {
    current_state: "published",
    id: "art_roadmap_q4",
    name: "Q4 roadmap locked plan",
    project_id: "proj_atlas",
    type: "doc",
  },
];

const heliosActivityData = [
  ["detect_incident", "Detect incident", "support"],
  ["triage_incident", "Triage severity", "support"],
  ["open_incident_ticket", "Open incident ticket", "support"],
  ["assign_owner", "Assign incident owner", "pm"],
  ["reproduce_issue", "Reproduce the issue", "eng"],
  ["root_cause_analysis", "Root cause analysis", "eng"],
  ["security_review", "Security review", "eng"],
  ["deploy_fix", "Deploy the fix", "eng"],
  ["verify_resolution", "Verify resolution", "support"],
  ["notify_customer", "Notify the customer", "pm"],
  ["write_postmortem", "Write the postmortem", "pmo"],
] as const;

const atlasActivityData = [
  ["capture_request", "Capture request", "pm"],
  ["qualify_business_case", "Qualify business case", "cpo"],
  ["estimate_effort", "Estimate effort", "eng"],
  ["roadmap_review", "Roadmap review", "cpo"],
  ["exec_approval", "Executive approval", "ceo"],
  ["update_roadmap", "Update roadmap", "cpo"],
  ["communicate_decision", "Communicate decision", "pm"],
  ["create_epic", "Create epic", "pmo"],
] as const;

const discoveredOnlyActivityData = [
  ["escalate_to_ceo", "Escalate to CEO", "support"],
  ["improvise_hotfix", "Improvise hotfix", "eng"],
  ["hold_customer_call", "Hold customer call", "pm"],
  ["negotiate_scope_offline", "Negotiate scope offline", "pm"],
] as const;

const heliosActivitySupport = new Map([
  ["detect_incident", { occurrences: 3, support: 3 }],
  ["triage_incident", { occurrences: 1, support: 1 }],
  ["open_incident_ticket", { occurrences: 1, support: 1 }],
  ["assign_owner", { occurrences: 2, support: 2 }],
  ["reproduce_issue", { occurrences: 0, support: 0 }],
  ["root_cause_analysis", { occurrences: 3, support: 2 }],
  ["security_review", { occurrences: 1, support: 1 }],
  ["deploy_fix", { occurrences: 2, support: 2 }],
  ["verify_resolution", { occurrences: 1, support: 1 }],
  ["notify_customer", { occurrences: 0, support: 0 }],
  ["write_postmortem", { occurrences: 0, support: 0 }],
]);

const atlasActivitySupport = new Map([
  ["capture_request", { occurrences: 1, support: 1 }],
  ["qualify_business_case", { occurrences: 1, support: 1 }],
  ["estimate_effort", { occurrences: 1, support: 1 }],
  ["roadmap_review", { occurrences: 1, support: 1 }],
  ["exec_approval", { occurrences: 1, support: 1 }],
  ["update_roadmap", { occurrences: 1, support: 1 }],
  ["communicate_decision", { occurrences: 0, support: 0 }],
  ["create_epic", { occurrences: 1, support: 1 }],
]);

const discoveredActivitySupport = new Map([
  ["escalate_to_ceo", { occurrences: 1, support: 1 }],
  ["improvise_hotfix", { occurrences: 1, support: 1 }],
  ["hold_customer_call", { occurrences: 1, support: 1 }],
  ["negotiate_scope_offline", { occurrences: 1, support: 1 }],
]);

const activity = (
  slug: string,
  label: string,
  role: Activity["role_expected"],
  project_id: Activity["project_id"],
  plane: Activity["plane"],
  support = 0,
  occurrences = 0,
  policy_ids: Activity["policy_ids"] = []
): Activity => ({
  authored_synonyms:
    slug === "security_review"
      ? [
          "security review",
          "pre-deploy checklist",
          "the checklist",
          "sec review",
        ]
      : [],
  description: `${label} synthetic fixture activity.`,
  first_seen_ts: support ? "2026-09-12T09:14:00.000Z" : undefined,
  id: `act_${slug}`,
  label,
  occurrences,
  plane,
  policy_ids,
  project_id,
  role_expected: role,
  roles_observed: support ? [role ?? "eng"] : [],
  slug,
  support,
});

export const fixtureActivities: Activity[] = [
  ...heliosActivityData.map(([slug, label, role]) => {
    const support = heliosActivitySupport.get(slug) ?? {
      occurrences: 0,
      support: 0,
    };
    return activity(
      slug,
      label,
      role,
      "proj_helios",
      support.support > 0 ? "both" : "designed",
      support.support,
      support.occurrences,
      slug === "security_review" ? ["pol_sec_review"] : []
    );
  }),
  ...atlasActivityData.map(([slug, label, role]) => {
    const support = atlasActivitySupport.get(slug) ?? {
      occurrences: 0,
      support: 0,
    };
    return activity(
      slug,
      label,
      role,
      "proj_atlas",
      support.support > 0 ? "both" : "designed",
      support.support,
      support.occurrences
    );
  }),
  ...discoveredOnlyActivityData.map(([slug, label, role]) => {
    const support = discoveredActivitySupport.get(slug) ?? {
      occurrences: 0,
      support: 0,
    };
    return activity(
      slug,
      label,
      role,
      slug.includes("scope") ? "proj_atlas" : "proj_helios",
      "discovered",
      support.support,
      support.occurrences
    );
  }),
];

export const fixturePolicies: Policy[] = [
  {
    activity_slug: "security_review",
    id: "pol_sec_review",
    kind: "ordering",
    params: { after: "deploy_fix", before: "security_review" },
    project_id: "proj_helios",
    text: "A security review must complete before any production deploy.",
  },
  {
    activity_slug: "issue_service_credit",
    id: "pol_credit_approval",
    kind: "threshold",
    params: { limit: 10_000, roles: ["cpo", "ceo"] },
    project_id: "proj_helios",
    text: "Service credits above 10000 require CPO or CEO approval.",
  },
  {
    activity_slug: "write_postmortem",
    id: "pol_postmortem",
    kind: "mandatory",
    params: {},
    project_id: "proj_helios",
    text: "Every P1 requires a written postmortem.",
  },
  {
    activity_slug: "roadmap_review",
    id: "pol_roadmap_review",
    kind: "ordering",
    params: { after: "update_roadmap", before: "roadmap_review" },
    project_id: "proj_atlas",
    text: "The roadmap may not be changed before CPO roadmap review.",
  },
  {
    activity_slug: "exec_approval",
    id: "pol_exec_threshold",
    kind: "approval",
    params: { after: "estimate_effort", roles: ["ceo"] },
    project_id: "proj_atlas",
    text: "Requests above 20 engineer-days require CEO approval.",
  },
];

const heliosMatrix = [
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
];

const atlasMatrix = [
  [0, 1, 0, 0, 0, 0, 0, 0],
  [0, 0, 1, 0, 0, 0, 0, 0],
  [0, 0, 0, 1, 0.4, 0, 0, 0],
  [0, 0, 0, 0, 1, 0, 0, 0],
  [0, 0, 0, 0, 0, 1, 0, 0],
  [0, 0, 0, 0, 0, 0, 1, 0],
  [0, 0, 0, 0, 0, 0, 0, 1],
  [0, 0, 0, 0, 0, 0, 0, 0],
];

export const fixtureWorkflows: Workflow[] = [
  {
    activity_slugs: heliosActivityData.map(([slug]) => slug),
    entry_activity: "detect_incident",
    exit_activities: ["notify_customer", "write_postmortem"],
    id: "wf_p1_incident",
    matrix: heliosMatrix,
    name: "Enterprise P1 incident response",
    plane: "designed",
    policy_ids: ["pol_sec_review", "pol_credit_approval", "pol_postmortem"],
    project_id: "proj_helios",
  },
  {
    activity_slugs: atlasActivityData.map(([slug]) => slug),
    entry_activity: "capture_request",
    exit_activities: ["create_epic"],
    id: "wf_feature_intake",
    matrix: atlasMatrix,
    name: "Feature intake",
    plane: "designed",
    policy_ids: ["pol_roadmap_review", "pol_exec_threshold"],
    project_id: "proj_atlas",
  },
];

export const fixtureWorkflowActivities: WorkflowActivity[] = [
  ...heliosActivityData.map(([slug, , role], rank) => ({
    activity_id: `act_${slug}` as const,
    rank,
    role_expected: role,
    workflow_id: "wf_p1_incident" as const,
  })),
  ...atlasActivityData.map(([slug, , role], rank) => ({
    activity_id: `act_${slug}` as const,
    rank,
    role_expected: role,
    workflow_id: "wf_feature_intake" as const,
  })),
];

export const fixtureRoleRepertoires: RoleRepertoire[] = [
  {
    never_performs: ["act_deploy_fix", "act_exec_approval"],
    performs: [
      "act_detect_incident",
      "act_triage_incident",
      "act_verify_resolution",
    ],
    role_id: "support",
  },
  {
    never_performs: ["act_issue_service_credit"],
    performs: [
      "act_reproduce_issue",
      "act_root_cause_analysis",
      "act_security_review",
      "act_deploy_fix",
      "act_improvise_hotfix",
    ],
    role_id: "eng",
  },
  {
    never_performs: ["act_deploy_fix"],
    performs: [
      "act_assign_owner",
      "act_notify_customer",
      "act_capture_request",
    ],
    role_id: "pm",
  },
  {
    never_performs: ["act_deploy_fix"],
    performs: [
      "act_roadmap_review",
      "act_update_roadmap",
      "act_qualify_business_case",
    ],
    role_id: "cpo",
  },
  {
    never_performs: ["act_deploy_fix", "act_estimate_effort"],
    performs: ["act_exec_approval", "act_escalate_to_ceo"],
    role_id: "ceo",
  },
  {
    never_performs: ["act_deploy_fix", "act_exec_approval"],
    performs: ["act_write_postmortem", "act_create_epic"],
    role_id: "pmo",
  },
];

export const fixtureArtifactLifecycles: ArtifactLifecycleDefinition[] = [
  {
    artifact_type: "incident",
    states: [
      "detected",
      "triaged",
      "owned",
      "mitigated",
      "resolved",
      "post-mortemed",
    ],
    transitions: [
      { activity_id: "act_detect_incident", from: "detected", to: "triaged" },
      { activity_id: "act_assign_owner", from: "triaged", to: "owned" },
      { activity_id: "act_deploy_fix", from: "owned", to: "mitigated" },
      {
        activity_id: "act_verify_resolution",
        from: "mitigated",
        to: "resolved",
      },
      {
        activity_id: "act_write_postmortem",
        from: "resolved",
        to: "post-mortemed",
      },
    ],
  },
  {
    artifact_type: "ticket",
    states: ["captured", "qualified", "estimated", "approved", "scheduled"],
    transitions: [
      { activity_id: "act_capture_request", from: "captured", to: "qualified" },
      {
        activity_id: "act_estimate_effort",
        from: "qualified",
        to: "estimated",
      },
      { activity_id: "act_exec_approval", from: "estimated", to: "approved" },
      { activity_id: "act_create_epic", from: "approved", to: "scheduled" },
    ],
  },
  {
    artifact_type: "doc",
    states: ["draft", "reviewed", "published"],
    transitions: [
      { activity_id: "act_security_review", from: "draft", to: "reviewed" },
      {
        activity_id: "act_write_postmortem",
        from: "reviewed",
        to: "published",
      },
    ],
  },
];

export const fixtureKb: KnowledgeBase = {
  activities: fixtureActivities,
  artifact_lifecycles: fixtureArtifactLifecycles,
  artifacts: fixtureArtifacts,
  authored_activity_synonyms: [
    {
      activity_id: "act_security_review",
      synonym: "the checklist",
    },
    {
      activity_id: "act_security_review",
      synonym: "sec review",
    },
  ],
  people: fixturePeople,
  policies: fixturePolicies,
  projects: fixtureProjects,
  role_repertoires: fixtureRoleRepertoires,
  roles: fixtureRoles,
  workflow_activities: fixtureWorkflowActivities,
  workflows: fixtureWorkflows,
};

export const fixtureSessions: ProcessSession[] = [
  {
    channel,
    ended_ts: "2026-09-12T09:55:00.000Z",
    extra: [],
    fitness: 0.82,
    id: "ses_helios_textbook",
    missing: ["write_postmortem"],
    project_id: "proj_helios",
    scenario_id: "scn_helios_p1",
    source: "simulation",
    started_ts: "2026-09-12T09:14:00.000Z",
    status: "closed",
    suggested: true,
    variant: "textbook",
    violations: [],
    workflow_id: "wf_p1_incident",
    workspace_id,
  },
  {
    channel,
    ended_ts: "2026-09-12T10:03:00.000Z",
    extra: ["escalate_to_ceo", "improvise_hotfix", "hold_customer_call"],
    fitness: 0.64,
    id: "ses_helios_skip_review",
    missing: ["security_review", "write_postmortem"],
    project_id: "proj_helios",
    scenario_id: "scn_helios_p1",
    source: "simulation",
    started_ts: "2026-09-12T09:58:00.000Z",
    status: "closed",
    suggested: true,
    variant: "skip_review",
    violations: ["pol_sec_review"],
    workflow_id: "wf_p1_incident",
    workspace_id,
  },
  {
    channel,
    ended_ts: null,
    extra: [],
    fitness: null,
    id: "ses_helios_rework",
    missing: [],
    project_id: "proj_helios",
    scenario_id: "scn_helios_p1",
    source: "simulation",
    started_ts: "2026-09-12T10:10:00.000Z",
    status: "open",
    suggested: false,
    variant: "rework",
    violations: [],
    workflow_id: "wf_p1_incident",
    workspace_id,
  },
  {
    channel,
    ended_ts: "2026-09-12T11:35:00.000Z",
    extra: ["negotiate_scope_offline"],
    fitness: 0.88,
    id: "ses_atlas_isolation",
    missing: [],
    project_id: "proj_atlas",
    scenario_id: "scn_atlas_feature",
    source: "simulation",
    started_ts: "2026-09-12T11:00:00.000Z",
    status: "closed",
    suggested: true,
    variant: "late_enterprise_request",
    violations: [],
    workflow_id: "wf_feature_intake",
    workspace_id,
  },
];

const message = (
  session_id: ProcessSession["id"],
  ts: Message["ts"],
  author_person_id: Message["author_person_id"],
  author_label: string,
  text: string,
  revision = 1,
  deleted = false
): Message => ({
  author_label,
  author_person_id,
  availability: deleted ? "deleted" : "available",
  channel,
  deleted,
  id: `${workspace_id}:${channel}:${ts}`,
  is_agent: false,
  permalink: `https://synthetic.invalid/archives/${channel}/p${ts.replace(".", "")}`,
  received_at: `2026-09-12T${ts.slice(0, 2)}:${ts.slice(2, 4)}:00.000Z`,
  revision,
  session_id,
  text,
  thread_ts: null,
  ts,
  workspace_id,
});

export const fixtureMessages: Message[] = [
  message(
    "ses_helios_textbook",
    "091400.000100",
    "per_priya",
    "Priya Raman",
    "Vertex checkout is throwing 500s; calling this a P1."
  ),
  message(
    "ses_helios_textbook",
    "091700.000200",
    "per_marc",
    "Marc Delacroix",
    "I assigned Tom and opened INC-4412."
  ),
  message(
    "ses_helios_textbook",
    "094200.000300",
    "per_tom",
    "Tom Becker",
    "Root cause is identified and the security review passed."
  ),
  message(
    "ses_helios_textbook",
    "095000.000400",
    "per_tom",
    "Tom Becker",
    "Fix is deployed and Priya verified checkout recovery."
  ),
  message(
    "ses_helios_skip_review",
    "095800.000100",
    "per_priya",
    "Priya Raman",
    "Vertex checkout failing again; Dana needs to know."
  ),
  message(
    "ses_helios_skip_review",
    "095900.000200",
    "per_dana",
    "Dana Okafor",
    "I assigned Tom directly; keep the logo unblocked."
  ),
  message(
    "ses_helios_skip_review",
    "100000.000300",
    "per_tom",
    "Tom Becker",
    "I'll push a mitigation before full root cause is known."
  ),
  message(
    "ses_helios_skip_review",
    "100100.000400",
    "per_tom",
    "Tom Becker",
    "Skipping the security checklist to save time."
  ),
  message(
    "ses_helios_skip_review",
    "100200.000500",
    "per_tom",
    "Tom Becker",
    "The mitigation hotfix is live."
  ),
  message(
    "ses_helios_skip_review",
    "100300.000600",
    "per_marc",
    "Marc Delacroix",
    "I am calling Vertex before verification finishes."
  ),
  message(
    "ses_helios_rework",
    "101000.000100",
    "per_priya",
    "Priya Raman",
    "New P1 on Vertex checkout; opened INC-4412 follow-up."
  ),
  message(
    "ses_helios_rework",
    "101200.000200",
    "per_tom",
    "Tom Becker",
    "I reproduced the issue and found the root cause."
  ),
  message(
    "ses_helios_rework",
    "101300.000300",
    "per_tom",
    "Tom Becker",
    "Deploy failed, rolling back and reworking root cause."
  ),
  message(
    "ses_helios_rework",
    "101500.000400",
    "per_tom",
    "Tom Becker",
    "Root cause reworked; second fix deployed."
  ),
  message(
    "ses_atlas_isolation",
    "110000.000100",
    "per_marc",
    "Marc Delacroix",
    "Captured Vertex SSO request for Atlas billing."
  ),
  message(
    "ses_atlas_isolation",
    "111000.000200",
    "per_sofia",
    "Sofia Lindqvist",
    "Business case is qualified; roadmap review is complete."
  ),
  message(
    "ses_atlas_isolation",
    "112000.000300",
    "per_tom",
    "Tom Becker",
    "Estimate is 24 engineer-days."
  ),
  message(
    "ses_atlas_isolation",
    "112500.000400",
    "per_dana",
    "Dana Okafor",
    "Approved the 24 day Atlas request."
  ),
  message(
    "ses_atlas_isolation",
    "113000.000500",
    "per_sofia",
    "Sofia Lindqvist",
    "Updated the Atlas roadmap after approval."
  ),
  message(
    "ses_atlas_isolation",
    "113500.000600",
    "per_lea",
    "Lea Moreau",
    "Created the Atlas epic.",
    2
  ),
];

const step = (
  id: Step["id"],
  session_id: ProcessSession["id"],
  seq: number,
  activity_id: Step["activity_id"],
  actor_person_id: Step["actor_person_id"],
  modality: Step["modality"],
  lifecycle_state: Step["lifecycle_state"],
  status: Step["status"],
  ts: Message["ts"],
  options: Partial<Step> = {}
): Step => ({
  activity_id,
  actor_person_id,
  artifact_id: options.artifact_id ?? "art_inc_4412",
  confidence: options.confidence ?? 0.86,
  evidence: [
    evidence(session_id, ts, options.evidence?.[0]?.message_revision ?? 1),
  ],
  handoff_to_person_id: options.handoff_to_person_id ?? null,
  id,
  intent:
    options.intent ?? `Synthetic ${activity_id ?? "unresolved"} work act.`,
  lifecycle_state,
  modality,
  negated: options.negated ?? modality === "negated",
  seq,
  session_id,
  status,
  ts_end: options.ts_end ?? null,
  ts_start: `2026-09-12T${ts.slice(0, 2)}:${ts.slice(2, 4)}:00.000Z`,
  type: options.type ?? "action",
});

export const fixtureSteps: Step[] = [
  step(
    "stp_helios_textbook_detect",
    "ses_helios_textbook",
    1,
    "act_detect_incident",
    "per_priya",
    "reported",
    "done",
    "confirmed",
    "091400.000100"
  ),
  step(
    "stp_helios_textbook_triage",
    "ses_helios_textbook",
    2,
    "act_triage_incident",
    "per_priya",
    "reported",
    "done",
    "confirmed",
    "091400.000100",
    { type: "decision" }
  ),
  step(
    "stp_helios_textbook_open",
    "ses_helios_textbook",
    3,
    "act_open_incident_ticket",
    "per_marc",
    "reported",
    "done",
    "confirmed",
    "091700.000200"
  ),
  step(
    "stp_helios_textbook_assign",
    "ses_helios_textbook",
    4,
    "act_assign_owner",
    "per_marc",
    "requested",
    "done",
    "confirmed",
    "091700.000200",
    { handoff_to_person_id: "per_tom", type: "handoff" }
  ),
  step(
    "stp_helios_textbook_root",
    "ses_helios_textbook",
    5,
    "act_root_cause_analysis",
    "per_tom",
    "reported",
    "done",
    "confirmed",
    "094200.000300"
  ),
  step(
    "stp_helios_textbook_security",
    "ses_helios_textbook",
    6,
    "act_security_review",
    "per_tom",
    "reported",
    "done",
    "confirmed",
    "094200.000300",
    { artifact_id: "art_sec_checklist" }
  ),
  step(
    "stp_helios_textbook_deploy",
    "ses_helios_textbook",
    7,
    "act_deploy_fix",
    "per_tom",
    "reported",
    "done",
    "confirmed",
    "095000.000400"
  ),
  step(
    "stp_helios_textbook_verify",
    "ses_helios_textbook",
    8,
    "act_verify_resolution",
    "per_priya",
    "reported",
    "done",
    "confirmed",
    "095000.000400"
  ),
  step(
    "stp_helios_skip_detect",
    "ses_helios_skip_review",
    1,
    "act_detect_incident",
    "per_priya",
    "reported",
    "done",
    "confirmed",
    "095800.000100"
  ),
  step(
    "stp_helios_skip_escalate",
    "ses_helios_skip_review",
    2,
    "act_escalate_to_ceo",
    "per_priya",
    "reported",
    "done",
    "confirmed",
    "095800.000100",
    { handoff_to_person_id: "per_dana", type: "handoff" }
  ),
  step(
    "stp_helios_skip_assign",
    "ses_helios_skip_review",
    3,
    "act_assign_owner",
    "per_dana",
    "reported",
    "done",
    "confirmed",
    "095900.000200",
    { handoff_to_person_id: "per_tom", type: "handoff" }
  ),
  step(
    "stp_helios_skip_promise",
    "ses_helios_skip_review",
    4,
    "act_improvise_hotfix",
    "per_tom",
    "committed",
    "committed",
    "confirmed",
    "100000.000300"
  ),
  step(
    "stp_helios_skip_negated_security",
    "ses_helios_skip_review",
    5,
    "act_security_review",
    "per_tom",
    "negated",
    "skipped",
    "confirmed",
    "100100.000400",
    { artifact_id: "art_sec_checklist" }
  ),
  step(
    "stp_helios_skip_hotfix_report",
    "ses_helios_skip_review",
    6,
    "act_improvise_hotfix",
    "per_tom",
    "reported",
    "done",
    "confirmed",
    "100200.000500",
    { type: "rework" }
  ),
  step(
    "stp_helios_skip_customer_call",
    "ses_helios_skip_review",
    7,
    "act_hold_customer_call",
    "per_marc",
    "reported",
    "done",
    "confirmed",
    "100300.000600"
  ),
  step(
    "stp_helios_skip_proposed_noise",
    "ses_helios_skip_review",
    8,
    "act_notify_customer",
    "per_marc",
    "reported",
    "done",
    "proposed",
    "100300.000600"
  ),
  step(
    "stp_helios_skip_rejected_noise",
    "ses_helios_skip_review",
    9,
    "act_notify_customer",
    "per_marc",
    "reported",
    "done",
    "rejected",
    "100300.000600"
  ),
  step(
    "stp_helios_rework_detect",
    "ses_helios_rework",
    1,
    "act_detect_incident",
    "per_priya",
    "reported",
    "done",
    "confirmed",
    "101000.000100"
  ),
  step(
    "stp_helios_rework_root",
    "ses_helios_rework",
    2,
    "act_root_cause_analysis",
    "per_tom",
    "reported",
    "done",
    "confirmed",
    "101200.000200"
  ),
  step(
    "stp_helios_rework_failed_deploy",
    "ses_helios_rework",
    3,
    "act_deploy_fix",
    "per_tom",
    "reported",
    "failed",
    "confirmed",
    "101300.000300"
  ),
  step(
    "stp_helios_rework_root_again",
    "ses_helios_rework",
    4,
    "act_root_cause_analysis",
    "per_tom",
    "reported",
    "done",
    "confirmed",
    "101500.000400",
    { type: "rework" }
  ),
  step(
    "stp_helios_rework_deploy",
    "ses_helios_rework",
    5,
    "act_deploy_fix",
    "per_tom",
    "reported",
    "done",
    "confirmed",
    "101500.000400"
  ),
  step(
    "stp_atlas_capture",
    "ses_atlas_isolation",
    1,
    "act_capture_request",
    "per_marc",
    "reported",
    "done",
    "confirmed",
    "110000.000100",
    { artifact_id: "art_req_vertex_sso" }
  ),
  step(
    "stp_atlas_qualify",
    "ses_atlas_isolation",
    2,
    "act_qualify_business_case",
    "per_sofia",
    "reported",
    "done",
    "confirmed",
    "111000.000200",
    { artifact_id: "art_req_vertex_sso" }
  ),
  step(
    "stp_atlas_estimate",
    "ses_atlas_isolation",
    3,
    "act_estimate_effort",
    "per_tom",
    "reported",
    "done",
    "confirmed",
    "112000.000300",
    { artifact_id: "art_req_vertex_sso", effort_days: 24 }
  ),
  step(
    "stp_atlas_review",
    "ses_atlas_isolation",
    4,
    "act_roadmap_review",
    "per_sofia",
    "reported",
    "done",
    "confirmed",
    "111000.000200",
    { artifact_id: "art_roadmap_q4" }
  ),
  step(
    "stp_atlas_approval",
    "ses_atlas_isolation",
    5,
    "act_exec_approval",
    "per_dana",
    "reported",
    "done",
    "confirmed",
    "112500.000400",
    { artifact_id: "art_req_vertex_sso", type: "approval" }
  ),
  step(
    "stp_atlas_negotiate_scope",
    "ses_atlas_isolation",
    6,
    "act_negotiate_scope_offline",
    "per_marc",
    "reported",
    "done",
    "confirmed",
    "113000.000500",
    { artifact_id: "art_roadmap_q4", type: "decision" }
  ),
  step(
    "stp_atlas_update",
    "ses_atlas_isolation",
    7,
    "act_update_roadmap",
    "per_sofia",
    "reported",
    "done",
    "confirmed",
    "113000.000500",
    { artifact_id: "art_roadmap_q4" }
  ),
  step(
    "stp_atlas_create",
    "ses_atlas_isolation",
    8,
    "act_create_epic",
    "per_lea",
    "reported",
    "done",
    "confirmed",
    "113500.000600",
    {
      artifact_id: "art_req_vertex_sso",
      evidence: [evidence("ses_atlas_isolation", "113500.000600", 2)],
    }
  ),
];

const node = (activity_id: Activity["id"]): GraphNode => {
  const found = fixtureActivities.find((item) => item.id === activity_id);
  if (!found) {
    throw new Error(`Missing fixture activity ${activity_id}`);
  }
  return {
    activity: found,
    id: activity_id,
    role_deviations:
      activity_id === "act_assign_owner"
        ? [
            {
              activity_id,
              evidence: [evidence("ses_helios_skip_review", "095900.000200")],
              expected: "pm",
              observed: "ceo",
              of: 3,
              sessions: ["ses_helios_skip_review"],
            },
          ]
        : [],
    unreconciled:
      activity_id === "act_write_postmortem"
        ? [
            {
              actor_person_id: "per_lea",
              evidence: [evidence("ses_helios_textbook", "095000.000400")],
              reason: "case_closed",
              state: "committed",
              step_id: "stp_helios_textbook_verify",
            },
          ]
        : [],
  };
};

const edge = (
  id: GraphEdge["id"],
  from: GraphEdge["from"],
  to: GraphEdge["to"],
  kind: GraphEdge["kind"],
  cases: GraphEdge["cases"],
  options: Partial<GraphEdge> = {}
): GraphEdge => ({
  cases,
  from,
  id,
  is_back_edge: options.is_back_edge ?? false,
  kind,
  observed_support: cases.length,
  plane: options.plane ?? "both",
  probability: options.probability ?? null,
  to,
  violates: options.violates ?? [],
  weight: options.weight ?? cases.length,
});

export const emptyDesignedGraph: GraphView = {
  conformance: null,
  edges: heliosActivityData
    .slice(0, -1)
    .map(([from], index) =>
      edge(
        `ged_empty_${from}_${heliosActivityData[index + 1]?.[0] ?? "end"}`,
        `act_${from}`,
        `act_${heliosActivityData[index + 1]?.[0] ?? "write_postmortem"}`,
        "sequence",
        [],
        { observed_support: 0, plane: "designed", probability: 1, weight: 1 }
      )
    ),
  generated_at: "2026-09-12T09:00:00.000Z",
  happy_path: [],
  key: "designed:wf_p1_incident",
  kind: "designed",
  min_support: 1,
  nodes: heliosActivityData.map(([slug]) => node(`act_${slug}`)),
  project_id: "proj_helios",
  revision: 0,
  workflow_id: "wf_p1_incident",
};

export const overlayGraph: GraphView = {
  conformance: {
    closed_sessions: 2,
    extra: [
      { occurrences: 1, slug: "escalate_to_ceo" },
      { occurrences: 1, slug: "improvise_hotfix" },
      { occurrences: 1, slug: "hold_customer_call" },
    ],
    fitness: 0.73,
    missing: [
      { of: 3, seen_in_sessions: 1, slug: "security_review" },
      { of: 3, seen_in_sessions: 0, slug: "write_postmortem" },
    ],
    open_sessions: 1,
    order_breaks: [
      {
        expected_between: "security_review",
        from: "root_cause_analysis",
        to: "deploy_fix",
      },
    ],
    precision: 0.75,
    role_deviations: [
      {
        activity_id: "act_assign_owner",
        evidence: [evidence("ses_helios_skip_review", "095900.000200")],
        expected: "pm",
        observed: "ceo",
        of: 3,
        sessions: ["ses_helios_skip_review"],
      },
    ],
    unreconciled: [
      {
        actor_person_id: "per_lea",
        evidence: [evidence("ses_helios_textbook", "095000.000400")],
        reason: "case_closed",
        state: "committed",
        step_id: "stp_helios_textbook_verify",
      },
    ],
    violations: [
      {
        evidence: [evidence("ses_helios_skip_review", "100100.000400")],
        policy_id: "pol_sec_review",
        quote: "Skipping the security checklist to save time.",
        text: "A security review must complete before any production deploy.",
      },
    ],
    workflow_id: "wf_p1_incident",
  },
  edges: [
    edge(
      "ged_detect_triage",
      "act_detect_incident",
      "act_triage_incident",
      "decision",
      ["ses_helios_textbook"],
      { probability: 1 }
    ),
    edge(
      "ged_detect_escalate",
      "act_detect_incident",
      "act_escalate_to_ceo",
      "handoff",
      ["ses_helios_skip_review"],
      { plane: "discovered", probability: 0.5 }
    ),
    edge(
      "ged_assign_root",
      "act_assign_owner",
      "act_root_cause_analysis",
      "handoff",
      ["ses_helios_textbook", "ses_helios_skip_review"],
      { weight: 2 }
    ),
    edge(
      "ged_root_security",
      "act_root_cause_analysis",
      "act_security_review",
      "sequence",
      ["ses_helios_textbook"]
    ),
    edge(
      "ged_root_deploy_violation",
      "act_root_cause_analysis",
      "act_deploy_fix",
      "sequence",
      ["ses_helios_rework"],
      { violates: ["pol_sec_review"] }
    ),
    edge(
      "ged_deploy_root_rework",
      "act_deploy_fix",
      "act_root_cause_analysis",
      "rework",
      ["ses_helios_rework"],
      { is_back_edge: true, plane: "discovered" }
    ),
    edge(
      "ged_hotfix_call",
      "act_improvise_hotfix",
      "act_hold_customer_call",
      "sequence",
      ["ses_helios_skip_review"],
      { plane: "discovered" }
    ),
  ],
  generated_at: "2026-09-12T10:20:00.000Z",
  happy_path: ["ged_detect_triage", "ged_assign_root", "ged_root_security"],
  key: "overlay:wf_p1_incident:min1",
  kind: "overlay",
  min_support: 1,
  nodes: [
    "act_detect_incident",
    "act_triage_incident",
    "act_assign_owner",
    "act_root_cause_analysis",
    "act_security_review",
    "act_deploy_fix",
    "act_verify_resolution",
    "act_write_postmortem",
    "act_escalate_to_ceo",
    "act_improvise_hotfix",
    "act_hold_customer_call",
  ].map((id) => node(id as Activity["id"])),
  project_id: "proj_helios",
  revision: 7,
  workflow_id: "wf_p1_incident",
};

export const removalDelta: GraphDelta = {
  base_revision: 7,
  edges_added: [],
  edges_removed: ["ged_hotfix_call"],
  edges_updated: [],
  nodes_added: [],
  nodes_removed: ["act_hold_customer_call"],
  nodes_updated: [node("act_security_review")],
  revision: 8,
  view_key: "overlay:wf_p1_incident:min1",
};

export const replayJournal: JournalEnvelope[] = [
  {
    channel,
    id: 101,
    kind: "message",
    payload: fixtureMessages[7],
    project_id: "proj_helios",
    session_id: "ses_helios_skip_review",
    ts: "2026-09-12T10:01:00.000Z",
    workspace_id,
  },
  {
    channel,
    id: 102,
    kind: "step",
    payload: fixtureSteps[12],
    project_id: "proj_helios",
    session_id: "ses_helios_skip_review",
    ts: "2026-09-12T10:01:02.000Z",
    workspace_id,
  },
  {
    channel,
    id: 103,
    kind: "graph_delta",
    payload: removalDelta,
    project_id: "proj_helios",
    session_id: "ses_helios_skip_review",
    ts: "2026-09-12T10:03:10.000Z",
    workspace_id,
  },
];

export const fixtureConformance: SessionConformance[] = [
  {
    extra: [
      { occurrences: 1, slug: "escalate_to_ceo" },
      { occurrences: 1, slug: "improvise_hotfix" },
    ],
    fitness: 0.64,
    missing: [
      { of: 3, seen_in_sessions: 1, slug: "security_review" },
      { of: 3, seen_in_sessions: 0, slug: "write_postmortem" },
    ],
    order_breaks: [
      {
        expected_between: "security_review",
        from: "root_cause_analysis",
        to: "deploy_fix",
      },
    ],
    precision: 0.72,
    role_deviations: [
      {
        activity_id: "act_assign_owner",
        evidence: [evidence("ses_helios_skip_review", "095900.000200")],
        expected: "pm",
        observed: "ceo",
        of: 3,
        sessions: ["ses_helios_skip_review"],
      },
    ],
    session_id: "ses_helios_skip_review",
    unreconciled: [
      {
        actor_person_id: "per_tom",
        evidence: [evidence("ses_helios_skip_review", "100000.000300")],
        reason: "still_open",
        state: "committed",
        step_id: "stp_helios_skip_promise",
      },
    ],
    violations: [
      {
        evidence: [evidence("ses_helios_skip_review", "100100.000400")],
        policy_id: "pol_sec_review",
        quote: "Skipping the security checklist to save time.",
        text: "A security review must complete before any production deploy.",
      },
    ],
    workflow_id: "wf_p1_incident",
  },
];

export const promiseReportReconciliationFixtures: PromiseReportReconciliation[] =
  [
    {
      report_step_id: "stp_helios_skip_hotfix_report",
      resolution: "advanced",
      source_step_id: "stp_helios_skip_promise",
    },
  ];

export const fixtureSnapshot: Snapshot = {
  conformance: fixtureConformance,
  cursor: 103,
  graph: overlayGraph,
  kb: fixtureKb,
  messages: fixtureMessages,
  sessions: fixtureSessions,
  steps: fixtureSteps,
};

export const fixtureCommands: Command[] = [
  {
    channel,
    kind: "run_simulation",
    request_id: "req_synth_run_001",
    scenario_id: "scn_helios_p1",
    variant: "skip_review",
    workspace_id,
  },
  {
    by: "per_dana",
    channel,
    kind: "pause_simulation",
    reason: "Human review requested",
    request_id: "req_synth_pause_001",
    session_id: "ses_helios_skip_review",
    workspace_id,
  },
  {
    channel,
    kind: "reject_step",
    request_id: "req_synth_reject_001",
    step_id: "stp_helios_skip_rejected_noise",
    workspace_id,
  },
];

export const fixtureCitations: Citation[] = [
  {
    id: "pol_sec_review",
    kind: "kb",
  },
  {
    count: 0,
    id: "act_security_review:support",
    kind: "count",
    metric: "support",
    of: 3,
  },
  {
    kind: "evidence",
    message_id: "T_SYNTH_FIXTURE:C_SYNTH_PROCESS:100100.000400",
    permalink:
      "https://synthetic.invalid/archives/C_SYNTH_PROCESS/p100100000400",
  },
];

export const errorFixtures: ApiError[] = [
  {
    error: {
      code: "unknown_id",
      message: "The requested synthetic fixture id does not exist.",
    },
  },
  {
    error: {
      code: "revision_mismatch",
      message: "The graph delta base revision does not match the client graph.",
    },
  },
  {
    error: {
      code: "invalid_evidence",
      message:
        "Step evidence must reference an available message in the same session scope.",
    },
  },
];
