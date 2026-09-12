import artifactLifecyclesData from "../kb/artifact-lifecycles.json" with {
  type: "json",
};
import artifactsData from "../kb/artifacts.json" with { type: "json" };
import peopleData from "../kb/people.json" with { type: "json" };
import policiesData from "../kb/policies.json" with { type: "json" };
import projectsData from "../kb/projects.json" with { type: "json" };
import roleCapabilitiesData from "../kb/role-capabilities.json" with {
  type: "json",
};
import legacyAccessData from "../kb/workflows/legacy_access.json" with {
  type: "json",
};
import legacyRefundData from "../kb/workflows/legacy_refund.json" with {
  type: "json",
};
import legacyVendorData from "../kb/workflows/legacy_vendor.json" with {
  type: "json",
};
import atlasWorkflowData from "../kb/workflows/wf_feature_intake.json" with {
  type: "json",
};
import heliosWorkflowData from "../kb/workflows/wf_p1_incident.json" with {
  type: "json",
};
import heliosOpsData from "../kb/workspaces/helios-ops.json" with {
  type: "json",
};

type JsonPrimitive = boolean | number | string | null;
type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue };

export type ArtifactType = "contract" | "doc" | "incident" | "ticket";
export type AuthoredNodeKind =
  | "artifact"
  | "artifact_lifecycle"
  | "person"
  | "policy"
  | "project"
  | "role_capability"
  | "workflow"
  | "workspace";
export type PolicyKind = "approval" | "mandatory" | "ordering" | "threshold";

export interface ActivityDefinition {
  label: string;
  role: string;
  slug: string;
  synonyms: string[];
}

export interface ArtifactDefinition {
  id: string;
  lifecycle_state: string;
  name: string;
  project_id: string;
  type: ArtifactType;
  uri?: string;
  value?: {
    amount: number;
    unit: string;
  };
}

export interface ArtifactLifecycleDefinition {
  advanced_by_roles: string[];
  states: string[];
  type: ArtifactType;
}

export interface AuthoredKb {
  artifactLifecycles: ArtifactLifecycleDefinition[];
  artifacts: ArtifactDefinition[];
  people: PersonDefinition[];
  policies: PolicyDefinition[];
  projects: ProjectDefinition[];
  roleCapabilities: RoleCapabilityDefinition[];
  workflows: WorkflowDefinition[];
  workspaces: WorkspaceDefinition[];
}

export interface DesignedGraphActivity {
  activityId: string;
  label: string;
  observedOccurrences: 0;
  observedSupport: 0;
  plane: "designed";
  rank: number;
  roleExpected: string;
  slug: string;
  synonyms: string[];
  workflowId: string;
}

export interface DesignedGraphEdge {
  fromActivityId: string;
  observedOccurrences: 0;
  observedSupport: 0;
  plane: "designed";
  toActivityId: string;
  weight: number;
  workflowId: string;
}

export interface DesignedGraph {
  activities: DesignedGraphActivity[];
  edges: DesignedGraphEdge[];
  entryActivity: string;
  exitActivities: string[];
  matrix: number[][];
  name: string;
  policyIds: string[];
  projectId: string | null;
  thresholdInputs: ThresholdInputDefinition[];
  workflowId: string;
}

export interface KbSeedResult {
  authoredNodes: number;
  workflowActivities: number;
  workflowFollows: number;
}

export interface KbSqlStatement {
  bindings: SqlBinding[];
  sql: string;
}

export interface PersonDefinition {
  biases: string[];
  color: string;
  comms_style: string;
  emoji: string;
  goals: string[];
  id: string;
  name: string;
  projects: string[];
  role: string;
  seniority: string;
}

export interface PolicyDefinition {
  activity_slug: string;
  id: string;
  kind: PolicyKind;
  params: Record<string, JsonValue>;
  project_id: string;
  text: string;
}

export interface ProjectDefinition {
  constraints: string[];
  id: string;
  name: string;
  spec_md: string;
  summary: string;
  workflow_id: string;
}

export interface RoleCapabilityDefinition {
  never_performs: string[];
  performs: string[];
  person_id: string;
  role: string;
}

export interface ThresholdInputDefinition {
  field: string;
  source: "artifact" | "project" | "step";
  type: "boolean" | "date" | "enum" | "number";
  unit?: string;
  values?: string[];
}

export interface WorkflowDefinition {
  activities: ActivityDefinition[];
  entry_activity: string;
  exit_activities: string[];
  id: string;
  matrix: number[][];
  name: string;
  policy_ids: string[];
  project_id: string | null;
  threshold_inputs: ThresholdInputDefinition[];
}

export interface WorkspaceDefinition {
  baseline_sessions: number;
  cast: {
    agenda: {
      bypasses: string[];
      objective: string;
      pressure: string;
      tell: string;
    };
    person_id: string;
    process_belief: string[];
  }[];
  demo_sequence: {
    introduces?: string[];
    mode: "baseline" | "live";
    variant: string;
  }[];
  expected_deviations: {
    explained_by: {
      kind: "agenda_bypass" | "belief_conflict";
      person_id: string;
      value: string;
    };
    slug: string;
  }[];
  id: string;
  name: string;
  process: string;
  project_id: string;
  scenarios: string[];
  slack: {
    channel_id: string;
    channel_name: string;
    workspace: string;
  };
}

type SqlBinding = null | number | string;

interface PayloadRow {
  id?: string;
  kind?: string;
  observed_occurrences?: number | null;
  observed_support?: number | null;
  payload: string;
}

const AUTHOR_SOURCE = "authored";
const NODE_UPSERT_SQL =
  "INSERT INTO pm_kb_nodes(kind,id,source,payload,authored_hash,updated_at) VALUES (?,?,?,?,?,?) ON CONFLICT(kind,id) DO UPDATE SET source=excluded.source,payload=excluded.payload,authored_hash=excluded.authored_hash,updated_at=excluded.updated_at WHERE pm_kb_nodes.source='authored'";
const WORKFLOW_ACTIVITY_UPSERT_SQL =
  "INSERT INTO pm_kb_workflow_activities(workflow_id,activity_id,source,rank,payload,authored_hash,updated_at,observed_support,observed_occurrences) VALUES (?,?,?,?,?,?,?,?,?) ON CONFLICT(workflow_id,activity_id) DO UPDATE SET source=excluded.source,rank=excluded.rank,payload=excluded.payload,authored_hash=excluded.authored_hash,updated_at=excluded.updated_at WHERE pm_kb_workflow_activities.source='authored'";
const WORKFLOW_FOLLOW_UPSERT_SQL =
  "INSERT INTO pm_kb_workflow_follows(workflow_id,from_activity_id,to_activity_id,source,weight,payload,authored_hash,updated_at,observed_support,observed_occurrences) VALUES (?,?,?,?,?,?,?,?,?,?) ON CONFLICT(workflow_id,from_activity_id,to_activity_id) DO UPDATE SET source=excluded.source,weight=excluded.weight,payload=excluded.payload,authored_hash=excluded.authored_hash,updated_at=excluded.updated_at WHERE pm_kb_workflow_follows.source='authored'";

let cachedKb: AuthoredKb | null = null;

export function activityId(slug: string) {
  return `act_${slug}`;
}

export function buildDesignedGraph(
  workflow: WorkflowDefinition
): DesignedGraph {
  return {
    activities: workflow.activities.map((activity, rank) => ({
      activityId: activityId(activity.slug),
      label: activity.label,
      observedOccurrences: 0,
      observedSupport: 0,
      plane: "designed",
      rank,
      roleExpected: activity.role,
      slug: activity.slug,
      synonyms: activity.synonyms,
      workflowId: workflow.id,
    })),
    edges: workflow.matrix.flatMap((row, fromIndex) =>
      row.flatMap((weight, toIndex) => {
        if (weight <= 0) {
          return [];
        }
        const from = workflow.activities[fromIndex];
        const to = workflow.activities[toIndex];
        if (!(from && to)) {
          throw new Error(`Invalid matrix edge in ${workflow.id}`);
        }
        return [
          {
            fromActivityId: activityId(from.slug),
            observedOccurrences: 0,
            observedSupport: 0,
            plane: "designed" as const,
            toActivityId: activityId(to.slug),
            weight,
            workflowId: workflow.id,
          },
        ];
      })
    ),
    entryActivity: workflow.entry_activity,
    exitActivities: workflow.exit_activities,
    matrix: workflow.matrix,
    name: workflow.name,
    policyIds: workflow.policy_ids,
    projectId: workflow.project_id,
    thresholdInputs: workflow.threshold_inputs,
    workflowId: workflow.id,
  };
}

export function buildKbSeedStatements(
  kb = loadKb(),
  now = new Date().toISOString()
): KbSqlStatement[] {
  const statements: KbSqlStatement[] = [];
  const addNode = (kind: AuthoredNodeKind, id: string, payload: JsonValue) => {
    const serialized = stableStringify(payload);
    statements.push({
      bindings: [kind, id, AUTHOR_SOURCE, serialized, serialized, now],
      sql: NODE_UPSERT_SQL,
    });
  };

  for (const person of kb.people) {
    addNode("person", person.id, person as unknown as JsonValue);
  }
  for (const project of kb.projects) {
    addNode("project", project.id, project as unknown as JsonValue);
  }
  for (const artifact of kb.artifacts) {
    addNode("artifact", artifact.id, artifact as unknown as JsonValue);
  }
  for (const policy of kb.policies) {
    addNode("policy", policy.id, policy as unknown as JsonValue);
  }
  for (const roleCapability of kb.roleCapabilities) {
    addNode(
      "role_capability",
      roleCapability.role,
      roleCapability as unknown as JsonValue
    );
  }
  for (const lifecycle of kb.artifactLifecycles) {
    addNode(
      "artifact_lifecycle",
      lifecycle.type,
      lifecycle as unknown as JsonValue
    );
  }
  for (const workflow of kb.workflows) {
    addNode("workflow", workflow.id, workflow as unknown as JsonValue);
    for (const activity of buildDesignedGraph(workflow).activities) {
      const serialized = stableStringify(activity as unknown as JsonValue);
      statements.push({
        bindings: [
          activity.workflowId,
          activity.activityId,
          AUTHOR_SOURCE,
          activity.rank,
          serialized,
          serialized,
          now,
          0,
          0,
        ],
        sql: WORKFLOW_ACTIVITY_UPSERT_SQL,
      });
    }
    for (const edge of buildDesignedGraph(workflow).edges) {
      const serialized = stableStringify(edge as unknown as JsonValue);
      statements.push({
        bindings: [
          edge.workflowId,
          edge.fromActivityId,
          edge.toActivityId,
          AUTHOR_SOURCE,
          edge.weight,
          serialized,
          serialized,
          now,
          0,
          0,
        ],
        sql: WORKFLOW_FOLLOW_UPSERT_SQL,
      });
    }
  }
  for (const workspace of kb.workspaces) {
    addNode("workspace", workspace.id, workspace as unknown as JsonValue);
  }

  return statements;
}

export function designedGraphFromBundle(workflowId: string, kb = loadKb()) {
  const workflow = kb.workflows.find((item) => item.id === workflowId);
  return workflow ? buildDesignedGraph(workflow) : null;
}

export function kbSummary(kb = loadKb()) {
  return {
    artifacts: kb.artifacts.length,
    designedEdges: kb.workflows.reduce(
      (sum, workflow) => sum + buildDesignedGraph(workflow).edges.length,
      0
    ),
    people: kb.people.length,
    policies: kb.policies.length,
    projects: kb.projects.length,
    roleCapabilities: kb.roleCapabilities.length,
    workflowActivities: kb.workflows.reduce(
      (sum, workflow) => sum + workflow.activities.length,
      0
    ),
    workflows: kb.workflows.length,
    workspaces: kb.workspaces.length,
  };
}

export function loadKb(): AuthoredKb {
  if (cachedKb) {
    return cachedKb;
  }
  const kb: AuthoredKb = {
    artifactLifecycles: artifactLifecyclesData as ArtifactLifecycleDefinition[],
    artifacts: artifactsData as ArtifactDefinition[],
    people: peopleData as PersonDefinition[],
    policies: policiesData as unknown as PolicyDefinition[],
    projects: projectsData as ProjectDefinition[],
    roleCapabilities: roleCapabilitiesData as RoleCapabilityDefinition[],
    workflows: [
      heliosWorkflowData,
      atlasWorkflowData,
      legacyVendorData,
      legacyRefundData,
      legacyAccessData,
    ] as WorkflowDefinition[],
    workspaces: [heliosOpsData as WorkspaceDefinition],
  };
  validateKb(kb);
  cachedKb = kb;
  return kb;
}

export async function readAuthoredKbNodes(db: D1Database) {
  const rows = await db
    .prepare(
      "SELECT kind,id,payload FROM pm_kb_nodes WHERE source = 'authored' ORDER BY kind,id"
    )
    .all<PayloadRow>();
  return rows.results.map((row) => ({
    id: row.id ?? "",
    kind: row.kind ?? "",
    payload: JSON.parse(row.payload) as JsonValue,
  }));
}

export async function readDesignedGraph(db: D1Database, workflowId: string) {
  const workflowRow = await db
    .prepare(
      "SELECT payload FROM pm_kb_nodes WHERE kind = 'workflow' AND id = ? AND source = 'authored'"
    )
    .bind(workflowId)
    .first<PayloadRow>();
  if (!workflowRow) {
    return null;
  }
  const workflow = JSON.parse(workflowRow.payload) as WorkflowDefinition;
  const activityRows = await db
    .prepare(
      "SELECT payload,observed_support,observed_occurrences FROM pm_kb_workflow_activities WHERE workflow_id = ? AND source = 'authored' ORDER BY rank,activity_id"
    )
    .bind(workflowId)
    .all<PayloadRow>();
  const followRows = await db
    .prepare(
      "SELECT payload,observed_support,observed_occurrences FROM pm_kb_workflow_follows WHERE workflow_id = ? AND source = 'authored' ORDER BY from_activity_id,to_activity_id"
    )
    .bind(workflowId)
    .all<PayloadRow>();
  return {
    ...buildDesignedGraph(workflow),
    activities: activityRows.results.map((row) => ({
      ...(JSON.parse(row.payload) as DesignedGraphActivity),
      observedOccurrences: 0 as const,
      observedSupport: 0 as const,
    })),
    edges: followRows.results.map((row) => ({
      ...(JSON.parse(row.payload) as DesignedGraphEdge),
      observedOccurrences: 0 as const,
      observedSupport: 0 as const,
    })),
  };
}

export async function seedKb(db: D1Database, now = new Date().toISOString()) {
  const statements = buildKbSeedStatements(loadKb(), now);
  await db.batch(
    statements.map((statement) =>
      db.prepare(statement.sql).bind(...statement.bindings)
    )
  );
  return statements.reduce<KbSeedResult>(
    (result, statement) => {
      if (statement.sql === NODE_UPSERT_SQL) {
        result.authoredNodes += 1;
      } else if (statement.sql === WORKFLOW_ACTIVITY_UPSERT_SQL) {
        result.workflowActivities += 1;
      } else if (statement.sql === WORKFLOW_FOLLOW_UPSERT_SQL) {
        result.workflowFollows += 1;
      }
      return result;
    },
    { authoredNodes: 0, workflowActivities: 0, workflowFollows: 0 }
  );
}

function assertUnique(values: string[], label: string) {
  const seen = new Set<string>();
  for (const value of values) {
    if (seen.has(value)) {
      throw new Error(`Duplicate ${label}: ${value}`);
    }
    seen.add(value);
  }
}

function stableStringify(value: JsonValue): string {
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableStringify(item)).join(",")}]`;
  }
  if (value && typeof value === "object") {
    return `{${Object.keys(value)
      .sort()
      .map(
        (key) => `${JSON.stringify(key)}:${stableStringify(value[key] ?? null)}`
      )
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

function validateKb(kb: AuthoredKb) {
  validateUniqueIds(kb);
  validateWorkflowReferences(kb);
  validateOrgReferences(kb);
  for (const workspace of kb.workspaces) {
    validateWorkspace(workspace, kb);
  }
}

function validateOrgReferences(kb: AuthoredKb) {
  const people = new Set(kb.people.map((person) => person.id));
  const projects = new Map(kb.projects.map((project) => [project.id, project]));
  const workflows = new Map(
    kb.workflows.map((workflow) => [workflow.id, workflow])
  );
  for (const project of kb.projects) {
    if (!workflows.has(project.workflow_id)) {
      throw new Error(`Project ${project.id} references unknown workflow`);
    }
  }
  for (const person of kb.people) {
    for (const projectId of person.projects) {
      if (!projects.has(projectId)) {
        throw new Error(
          `Person ${person.id} references unknown project ${projectId}`
        );
      }
    }
  }
  for (const artifact of kb.artifacts) {
    if (!projects.has(artifact.project_id)) {
      throw new Error(`Artifact ${artifact.id} references unknown project`);
    }
  }
  for (const roleCapability of kb.roleCapabilities) {
    if (!people.has(roleCapability.person_id)) {
      throw new Error(
        `Role capability ${roleCapability.role} has unknown person`
      );
    }
  }
}

function validateUniqueIds(kb: AuthoredKb) {
  assertUnique(
    kb.people.map((person) => person.id),
    "person id"
  );
  assertUnique(
    kb.projects.map((project) => project.id),
    "project id"
  );
  assertUnique(
    kb.artifacts.map((artifact) => artifact.id),
    "artifact id"
  );
  assertUnique(
    kb.policies.map((policy) => policy.id),
    "policy id"
  );
  assertUnique(
    kb.workflows.map((workflow) => workflow.id),
    "workflow id"
  );
  assertUnique(
    kb.workspaces.map((workspace) => workspace.id),
    "workspace id"
  );
}

function validateWorkflowReferences(kb: AuthoredKb) {
  const policies = new Map(kb.policies.map((policy) => [policy.id, policy]));
  const projects = new Map(kb.projects.map((project) => [project.id, project]));
  const workflowActivitiesByProject = new Map<string, Set<string>>();

  for (const workflow of kb.workflows) {
    validateWorkflow(workflow);
    if (workflow.project_id) {
      workflowActivitiesByProject.set(
        workflow.project_id,
        new Set(workflow.activities.map((activity) => activity.slug))
      );
    }
    for (const policyId of workflow.policy_ids) {
      const policy = policies.get(policyId);
      if (!policy) {
        throw new Error(
          `Workflow ${workflow.id} references unknown policy ${policyId}`
        );
      }
      if (workflow.project_id && policy.project_id !== workflow.project_id) {
        throw new Error(`Policy ${policyId} does not belong to ${workflow.id}`);
      }
    }
  }

  for (const policy of kb.policies) {
    const project = projects.get(policy.project_id);
    if (!project) {
      throw new Error(`Policy ${policy.id} references unknown project`);
    }
    if (
      !workflowActivitiesByProject.get(project.id)?.has(policy.activity_slug)
    ) {
      throw new Error(`Policy ${policy.id} references unknown activity`);
    }
  }
}

function validateWorkflow(workflow: WorkflowDefinition) {
  const slugs = workflow.activities.map((activity) => activity.slug);
  assertUnique(slugs, `${workflow.id} activity slug`);
  const slugSet = new Set(slugs);
  if (!slugSet.has(workflow.entry_activity)) {
    throw new Error(`Workflow ${workflow.id} has an unknown entry activity`);
  }
  for (const exit of workflow.exit_activities) {
    if (!slugSet.has(exit)) {
      throw new Error(`Workflow ${workflow.id} has an unknown exit activity`);
    }
  }
  if (workflow.matrix.length !== workflow.activities.length) {
    throw new Error(`Workflow ${workflow.id} matrix height mismatch`);
  }
  for (const [index, row] of workflow.matrix.entries()) {
    if (row.length !== workflow.activities.length) {
      throw new Error(
        `Workflow ${workflow.id} matrix row ${index} width mismatch`
      );
    }
    for (const weight of row) {
      if (weight < 0 || weight > 1) {
        throw new Error(`Workflow ${workflow.id} has invalid matrix weight`);
      }
    }
  }
  for (const activity of workflow.activities) {
    if (!activity.synonyms.length) {
      throw new Error(
        `Activity ${workflow.id}:${activity.slug} has no synonyms`
      );
    }
  }
}

function validateWorkspace(workspace: WorkspaceDefinition, kb: AuthoredKb) {
  const people = new Set(kb.people.map((person) => person.id));
  const workflow = kb.workflows.find((item) => item.id === workspace.process);
  const project = kb.projects.find((item) => item.id === workspace.project_id);
  if (!workflow) {
    throw new Error(`Workspace ${workspace.id} references unknown workflow`);
  }
  if (!project) {
    throw new Error(`Workspace ${workspace.id} references unknown project`);
  }
  const slugs = new Set(workflow.activities.map((activity) => activity.slug));
  for (const castMember of workspace.cast) {
    if (!people.has(castMember.person_id)) {
      throw new Error(`Workspace ${workspace.id} has unknown cast member`);
    }
    validateProcessBeliefs(workspace.id, castMember.process_belief, slugs);
  }
  for (const deviation of workspace.expected_deviations) {
    validateWorkspaceDeviation(workspace, deviation, people);
  }
}

function validateProcessBeliefs(
  workspaceId: string,
  beliefs: string[],
  workflowSlugs: Set<string>
) {
  for (const belief of beliefs) {
    if (!(workflowSlugs.has(belief) || isKnownUndocumentedActivity(belief))) {
      throw new Error(`Workspace ${workspaceId} has unknown belief ${belief}`);
    }
  }
}

function validateWorkspaceDeviation(
  workspace: WorkspaceDefinition,
  deviation: WorkspaceDefinition["expected_deviations"][number],
  people: Set<string>
) {
  if (!people.has(deviation.explained_by.person_id)) {
    throw new Error(`Workspace ${workspace.id} has unknown deviation owner`);
  }
  const owner = workspace.cast.find(
    (member) => member.person_id === deviation.explained_by.person_id
  );
  if (!owner) {
    throw new Error(`Workspace ${workspace.id} has deviation outside cast`);
  }
  if (
    deviation.explained_by.kind === "agenda_bypass" &&
    !owner.agenda.bypasses.includes(deviation.explained_by.value)
  ) {
    throw new Error(`Deviation ${deviation.slug} is not explained by agenda`);
  }
  if (
    deviation.explained_by.kind === "belief_conflict" &&
    !owner.process_belief.includes(deviation.explained_by.value)
  ) {
    throw new Error(`Deviation ${deviation.slug} is not explained by belief`);
  }
}

function isKnownUndocumentedActivity(slug: string) {
  return [
    "escalate_to_ceo",
    "hold_customer_call",
    "improvise_hotfix",
    "negotiate_scope_offline",
  ].includes(slug);
}
