import type { Spec08CompatibilityBridge } from "../../shared/contracts.ts";
import {
  type ActivityEvent,
  type AgentEvent,
  activityGrounding,
  activityWorkspace,
  DEFAULT_WORKSPACE,
  type DesignedModel,
  designedEdgesFrom,
  isWorkflow,
  type MessageRef,
  mine,
  type PipelineEvent,
  type WorkflowLink,
  type WorkspaceDto,
} from "../../shared/process.ts";

export interface Spec08CompatibilityFixtureSet {
  agentEvents: AgentEvent[];
  bridge: Spec08CompatibilityBridge;
  designed: DesignedModel[];
  events: ActivityEvent[];
  links: WorkflowLink[];
  pipelineEvents: PipelineEvent[];
  workspaces: WorkspaceDto[];
}

export interface FixtureValidationResult {
  errors: string[];
  ok: boolean;
}

const channel = "C_ACCESS_DEMO";
const workspace = DEFAULT_WORKSPACE;

const message = (
  ts: string,
  author: string,
  authorId: string,
  text: string,
  permalink = `https://synthetic.invalid/archives/${channel}/p${ts.replace(".", "")}`
): MessageRef => ({
  author,
  authorId,
  channel,
  permalink,
  text,
  ts,
  workspace,
});

const requestedMessage = message(
  "1789207200.000100",
  "Maya Chen",
  "U_MAYA",
  "Please grant Quinn access to the production dashboard."
);
const securitySkipMessage = message(
  "1789207800.000300",
  "Oliver Park",
  "U_OLIVER",
  "Skipping the Security review because Finance is waiting."
);
const closedMessage = message(
  "1789208100.000500",
  "Noah Patel",
  "U_NOAH",
  "Closing this request out.",
  ""
);

export const accessDesignedModel: DesignedModel = {
  activities: [
    {
      label: "Access requested",
      role: "Operations",
      slug: "Access requested",
      synonyms: ["request access", "access ask"],
    },
    {
      label: "Manager review",
      role: "Team lead",
      slug: "Manager review",
    },
    {
      label: "Security review",
      role: "Compliance",
      slug: "Security review",
      synonyms: ["security check", "sec review"],
    },
    {
      label: "Access granted",
      role: "IT",
      slug: "Access granted",
    },
    {
      label: "Request closed",
      role: "IT",
      slug: "Request closed",
    },
  ],
  entry: "Access requested",
  matrix: [
    [0, 1, 0, 0, 0],
    [0, 0, 1, 0, 0],
    [0, 0, 0, 1, 0],
    [0, 0, 0, 0, 1],
    [0, 0, 0, 0, 0],
  ],
  policies: [
    {
      after: "Manager review",
      before: "Access granted",
      id: "pol_access_security_review",
      kind: "mandatory",
      roles: ["Compliance"],
      text: "Security review is mandatory before granting production access.",
      workflow: "access",
    },
  ],
  workflow: "access",
};

export const spec08ActivityEvents: ActivityEvent[] = [
  {
    action: "Access requested",
    actor: "Maya Chen",
    artifact: "Production dashboard",
    caseId: "ACC-201",
    id: "spec08:access:201:1",
    messages: [requestedMessage],
    modality: "requested",
    role: "Operations",
    sequence: 1,
    source: "slack",
    state: "requested",
    timestamp: "2026-09-12T10:00:00.000Z",
    workflow: "access",
    workspace,
  },
  {
    action: "Manager review",
    actor: "Sofia Reyes",
    artifact: "Production dashboard",
    caseId: "ACC-201",
    id: "spec08:access:201:2",
    modality: "committed",
    role: "Team lead",
    sequence: 2,
    source: "simulation",
    state: "committed",
    status: "confirmed",
    timestamp: "2026-09-12T10:07:00.000Z",
    workflow: "access",
  },
  {
    action: "Security review",
    actor: "Oliver Park",
    artifact: "Production dashboard",
    caseId: "ACC-201",
    id: "spec08:access:201:3",
    messages: [securitySkipMessage],
    modality: "negated",
    role: "Compliance",
    sequence: 3,
    source: "slack",
    state: "skipped",
    status: "confirmed",
    timestamp: "2026-09-12T10:10:00.000Z",
    workflow: "access",
    workspace,
  },
  {
    action: "Access granted",
    actor: "Noah Patel",
    artifact: "Production dashboard",
    caseId: "ACC-201",
    id: "spec08:access:201:4",
    modality: "reported",
    role: "IT",
    sequence: 4,
    source: "simulation",
    state: "done",
    timestamp: "2026-09-12T10:15:00.000Z",
    workflow: "access",
  },
  {
    action: "Request closed",
    actor: "Noah Patel",
    artifact: "Production dashboard",
    caseId: "ACC-201",
    id: "spec08:access:201:5",
    messages: [closedMessage],
    modality: "reported",
    role: "IT",
    sequence: 5,
    source: "slack",
    state: "done",
    status: "rejected",
    timestamp: "2026-09-12T10:20:00.000Z",
    workflow: "access",
    workspace,
  },
  {
    action: "Access requested",
    actor: "Maya Chen",
    artifact: "Engineering repository",
    caseId: "ACC-202",
    confidence: 0.35,
    id: "spec08:access:202:1",
    messages: [
      message(
        "1789209000.000100",
        "Maya Chen",
        "U_MAYA",
        "Maybe this repo access request was abandoned.",
        ""
      ),
    ],
    modality: "reported",
    role: "Operations",
    sequence: 1,
    source: "slack",
    state: "abandoned",
    status: "proposed",
    timestamp: "2026-09-12T10:30:00.000Z",
    workflow: "access",
    workspace,
  },
];

export const emptyDesignedAccessGraph = {
  designed: accessDesignedModel,
  events: [] satisfies ActivityEvent[],
  model: mine([], accessDesignedModel),
};

export const spec08AgentEvents: AgentEvent[] = [
  {
    caseId: "ACC-201",
    citations: [requestedMessage],
    createdAt: "2026-09-12T10:00:02.000Z",
    id: "agent:playbook:approve",
    kind: "playbook",
    nodes: ["Access requested", "Manager review", "Security review"],
    pauses: true,
    resolution: "approve",
    text: "Access request matches the documented workflow.",
    workflow: "access",
  },
  {
    caseId: "ACC-201",
    citations: [securitySkipMessage],
    createdAt: "2026-09-12T10:10:03.000Z",
    id: "agent:drift:hold",
    kind: "drift",
    nodes: ["Security review", "Access granted"],
    pauses: false,
    policyId: "pol_access_security_review",
    resolution: "hold",
    text: "Security review was skipped before access was granted.",
    workflow: "access",
  },
  {
    caseId: "ACC-202",
    citations: [],
    createdAt: "2026-09-12T10:31:00.000Z",
    id: "agent:playbook:reject",
    kind: "playbook",
    nodes: ["Access requested"],
    pauses: true,
    resolution: "reject",
    text: "The abandoned request should not enter the playbook.",
    workflow: "access",
  },
  {
    citations: [securitySkipMessage],
    createdAt: "2026-09-12T10:32:00.000Z",
    id: "agent:answer:security",
    kind: "answer",
    nodes: ["Security review"],
    pauses: false,
    text: "The Security review skip is evidenced by Oliver's message.",
    workflow: "access",
  },
];

export const spec08PipelineEvents: PipelineEvent[] = [
  {
    caseId: "ACC-201",
    createdAt: "2026-09-12T10:00:00.000Z",
    id: "pipe:message:1",
    kind: "message",
    message: requestedMessage,
    text: "Maya Chen requested production dashboard access.",
    workflow: "access",
    workspace,
  },
  {
    activity: "Security review",
    caseId: "ACC-201",
    confidence: 0.88,
    createdAt: "2026-09-12T10:10:01.000Z",
    id: "pipe:extract:security-skip",
    kind: "extract",
    messages: [securitySkipMessage],
    text: "Extracted negated Security review step.",
    workflow: "access",
    workspace,
  },
  {
    activity: "Security review",
    caseId: "ACC-201",
    createdAt: "2026-09-12T10:10:02.000Z",
    id: "pipe:ground:security-skip",
    kind: "ground",
    messages: [securitySkipMessage],
    text: "Grounded skip to one scoped Slack message reference.",
    workflow: "access",
    workspace,
  },
  {
    activity: "Security review",
    caseId: "ACC-201",
    createdAt: "2026-09-12T10:10:03.000Z",
    id: "pipe:canon:security-skip",
    kind: "canon",
    nodes: ["Security review"],
    text: "Matched Security review to the designed access activity.",
    workflow: "access",
    workspace,
  },
  {
    activity: "Security review",
    caseId: "ACC-201",
    createdAt: "2026-09-12T10:10:04.000Z",
    id: "pipe:graph:security-skip",
    kind: "graph",
    nodes: ["Manager review", "Access granted"],
    text: "Excluded negated step from discovered edges and flagged policy.",
    workflow: "access",
    workspace,
  },
  {
    caseId: "ACC-201",
    createdAt: "2026-09-12T10:10:05.000Z",
    id: "pipe:agent:security-skip",
    kind: "agent",
    messages: [securitySkipMessage],
    nodes: ["Security review"],
    text: "Drift alert prepared for Security review skip.",
    workflow: "access",
    workspace,
  },
];

export const spec08Workspaces: WorkspaceDto[] = [
  {
    channel,
    id: workspace,
    name: "Demo workspace",
    workflows: ["vendor", "refund", "access"],
  },
];

export const spec08WorkflowLinks: WorkflowLink[] = [
  {
    artifact: "Engineering repository",
    cases: [{ source: "ACC-202", target: "VEN-314" }],
    count: 1,
    source: "access",
    target: "vendor",
  },
];

export const spec08Bridge: Spec08CompatibilityBridge = {
  agentEvents: spec08AgentEvents,
  designed: accessDesignedModel,
  designedEdges: designedEdgesFrom(accessDesignedModel),
  links: spec08WorkflowLinks,
  messages: [requestedMessage, securitySkipMessage, closedMessage],
  pipelineEvents: spec08PipelineEvents,
  workspace: spec08Workspaces[0],
};

export const spec08CompatibilityFixtures: Spec08CompatibilityFixtureSet = {
  agentEvents: spec08AgentEvents,
  bridge: spec08Bridge,
  designed: [accessDesignedModel],
  events: spec08ActivityEvents,
  links: spec08WorkflowLinks,
  pipelineEvents: spec08PipelineEvents,
  workspaces: spec08Workspaces,
};

export function validateMessageRef(
  owner: string,
  ref: MessageRef,
  errors: string[],
  expectedChannel?: string,
  expectedWorkspace?: string
) {
  if (!(ref.author && ref.authorId && ref.channel && ref.text && ref.ts)) {
    errors.push(`${owner} has an incomplete message reference`);
  }
  if (expectedChannel && ref.channel !== expectedChannel) {
    errors.push(`${owner} references channel ${ref.channel} outside scope`);
  }
  if (
    expectedWorkspace &&
    ref.workspace &&
    ref.workspace !== expectedWorkspace
  ) {
    errors.push(`${owner} references workspace ${ref.workspace} outside scope`);
  }
  if (ref.permalink && !ref.permalink.startsWith("https://")) {
    errors.push(`${owner} has an invalid message permalink`);
  }
}

export function validateSpec08CompatibilityFixtures(
  fixtureSet: Spec08CompatibilityFixtureSet = spec08CompatibilityFixtures
): FixtureValidationResult {
  const errors: string[] = [];
  const cases = new Set(fixtureSet.events.map((event) => event.caseId));
  const designedActivities = new Set(
    fixtureSet.designed.flatMap((designed) =>
      designed.activities.map((activity) => activity.slug)
    )
  );

  validateDesignedModels(fixtureSet.designed, errors);
  validateEvents(fixtureSet.events, errors);
  validateAgentEvents(
    fixtureSet.agentEvents,
    cases,
    designedActivities,
    errors
  );
  validatePipelineEvents(
    fixtureSet.pipelineEvents,
    cases,
    designedActivities,
    errors
  );
  validateWorkspaces(fixtureSet.workspaces, errors);
  validateLinks(fixtureSet.links, errors);

  return { errors, ok: errors.length === 0 };
}

export function spec08GroundingCoverage() {
  return new Set(spec08ActivityEvents.map((event) => activityGrounding(event)));
}

function validateAgentEvents(
  agentEvents: readonly AgentEvent[],
  cases: ReadonlySet<string>,
  designedActivities: ReadonlySet<string>,
  errors: string[]
) {
  for (const event of agentEvents) {
    if (event.caseId && !cases.has(event.caseId)) {
      errors.push(`agent event ${event.id} references unknown case`);
    }
    if (!isWorkflow(event.workflow)) {
      errors.push(`agent event ${event.id} references unknown workflow`);
    }
    for (const node of event.nodes) {
      if (!designedActivities.has(node)) {
        errors.push(`agent event ${event.id} references unknown node ${node}`);
      }
    }
    for (const ref of event.citations) {
      validateMessageRef(
        `agent event ${event.id}`,
        ref,
        errors,
        channel,
        workspace
      );
    }
  }
}

function validateDesignedModels(
  designedModels: readonly DesignedModel[],
  errors: string[]
) {
  for (const designed of designedModels) {
    const slugs = new Set(designed.activities.map((activity) => activity.slug));
    validateDesignedMatrix(designed, errors);
    if (!slugs.has(designed.entry)) {
      errors.push(`designed model ${designed.workflow} entry is unknown`);
    }
    validateDesignedPolicies(designed, slugs, errors);
    for (const edge of designedEdgesFrom(designed)) {
      if (edge.count !== 0 || edge.evidence.length !== 0) {
        errors.push(`designed edge ${edge.id} contains observed evidence`);
      }
    }
  }
}

function validateDesignedMatrix(designed: DesignedModel, errors: string[]) {
  if (!isWorkflow(designed.workflow)) {
    errors.push("designed model references unknown workflow");
  }
  if (designed.matrix.length !== designed.activities.length) {
    errors.push(`designed model ${designed.workflow} matrix row mismatch`);
  }
  for (const [index, row] of designed.matrix.entries()) {
    if (row.length !== designed.activities.length) {
      errors.push(
        `designed model ${designed.workflow} matrix row ${index} width mismatch`
      );
    }
  }
}

function validateDesignedPolicies(
  designed: DesignedModel,
  slugs: ReadonlySet<string>,
  errors: string[]
) {
  for (const policy of designed.policies) {
    if (policy.workflow !== designed.workflow) {
      errors.push(`policy ${policy.id} uses the wrong workflow`);
    }
    if (policy.after && !slugs.has(policy.after)) {
      errors.push(`policy ${policy.id} has unknown after activity`);
    }
    if (policy.before && !slugs.has(policy.before)) {
      errors.push(`policy ${policy.id} has unknown before activity`);
    }
  }
}

function validateEvents(events: readonly ActivityEvent[], errors: string[]) {
  for (const event of events) {
    if (!isWorkflow(event.workflow)) {
      errors.push(`event ${event.id} references unknown workflow`);
    }
    const confidence = event.confidence ?? 1;
    if (confidence < 0 || confidence > 1) {
      errors.push(`event ${event.id} confidence is outside 0..1`);
    }
    if (!activityWorkspace(event)) {
      errors.push(`event ${event.id} has no workspace scope`);
    }
    for (const ref of event.messages ?? []) {
      validateMessageRef(
        `event ${event.id}`,
        ref,
        errors,
        channel,
        activityWorkspace(event)
      );
    }
  }
}

function validateLinks(links: readonly WorkflowLink[], errors: string[]) {
  for (const link of links) {
    if (!(isWorkflow(link.source) && isWorkflow(link.target))) {
      errors.push(`workflow link ${link.artifact} has unknown workflow`);
    }
    if (link.count !== link.cases.length) {
      errors.push(`workflow link ${link.artifact} count mismatch`);
    }
    if (!link.artifact) {
      errors.push("workflow link has no artifact");
    }
  }
}

function validatePipelineEvents(
  pipelineEvents: readonly PipelineEvent[],
  cases: ReadonlySet<string>,
  designedActivities: ReadonlySet<string>,
  errors: string[]
) {
  for (const event of pipelineEvents) {
    if (event.caseId && !cases.has(event.caseId)) {
      errors.push(`pipeline event ${event.id} references unknown case`);
    }
    if (event.activity && !designedActivities.has(event.activity)) {
      errors.push(
        `pipeline event ${event.id} references unknown activity ${event.activity}`
      );
    }
    if (!isWorkflow(event.workflow)) {
      errors.push(`pipeline event ${event.id} references unknown workflow`);
    }
    if (!(event.workspace ?? DEFAULT_WORKSPACE)) {
      errors.push(`pipeline event ${event.id} has no workspace scope`);
    }
    if (event.message) {
      validateMessageRef(
        `pipeline event ${event.id}`,
        event.message,
        errors,
        channel,
        event.workspace ?? DEFAULT_WORKSPACE
      );
    }
    for (const ref of event.messages ?? []) {
      validateMessageRef(
        `pipeline event ${event.id}`,
        ref,
        errors,
        channel,
        event.workspace ?? DEFAULT_WORKSPACE
      );
    }
  }
}

function validateWorkspaces(
  workspaces: readonly WorkspaceDto[],
  errors: string[]
) {
  for (const item of workspaces) {
    if (!(item.channel && item.id && item.name)) {
      errors.push(`workspace ${item.id} has incomplete scope`);
    }
    for (const workflow of item.workflows) {
      if (!isWorkflow(workflow)) {
        errors.push(`workspace ${item.id} references unknown workflow`);
      }
    }
  }
}
