// Workspace-authored knowledge base, read from D1.
//
// This replaces the checked-in synthetic knowledge base. It returns the same
// AuthoredKb shape the mining, conformance and UI layers already consume, so the
// designed-vs-discovered comparison is unchanged: only the authorship moves from
// files in the repository to rows a workspace owns.

export type PolicyKind = "approval" | "mandatory" | "ordering" | "threshold";

export interface ActivityDefinition {
  label: string;
  role: string;
  slug: string;
  synonyms: string[];
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
  params: Record<string, unknown>;
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
  role: string;
}

export interface RoleDefinition {
  id: string;
  name: string;
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
}

export interface TenantKb {
  people: PersonDefinition[];
  policies: PolicyDefinition[];
  projects: ProjectDefinition[];
  roleCapabilities: RoleCapabilityDefinition[];
  roles: RoleDefinition[];
  workflows: WorkflowDefinition[];
  workspaceId: string;
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
  workflowId: string;
}

interface ProjectRow {
  constraints_json: string;
  id: string;
  name: string;
  spec_md: string;
  summary: string;
  workflow_id: string | null;
}

interface WorkflowRow {
  entry_slug: string;
  exit_slugs_json: string;
  id: string;
  name: string;
  project_id: string;
}

interface ActivityRow {
  label: string;
  rank: number;
  role_expected: string | null;
  slug: string;
  synonyms_json: string;
  workflow_id: string;
}

interface EdgeRow {
  from_slug: string;
  probability: number;
  to_slug: string;
  workflow_id: string;
}

interface PolicyRow {
  activity_slug: string;
  id: string;
  kind: PolicyKind;
  params_json: string;
  project_id: string;
  text: string;
}

interface PersonRow {
  color: string;
  display_name: string;
  person_id: string;
  real_name: string;
  role_id: string | null;
  title: string;
}

interface RoleRow {
  id: string;
  name: string;
}

interface RepertoireRow {
  activity_slug: string;
  relation: "never_performs" | "performs";
  role_id: string;
}

export function activityId(slug: string) {
  return `act_${slug}`;
}

function parseJsonArray(raw: string): string[] {
  try {
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed)
      ? parsed.filter((item): item is string => typeof item === "string")
      : [];
  } catch {
    return [];
  }
}

function parseJsonObject(raw: string): Record<string, unknown> {
  try {
    const parsed: unknown = JSON.parse(raw);
    return typeof parsed === "object" &&
      parsed !== null &&
      !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

/**
 * Builds the designed follows matrix. Authored edges take precedence; when a
 * workflow has no explicit edges the activity order defines a linear happy path,
 * which is what the setup UI produces for a simple ordered checklist.
 */
function buildMatrix(
  activities: readonly ActivityDefinition[],
  edges: readonly EdgeRow[]
) {
  const index = new Map(
    activities.map((activity, position) => [activity.slug, position])
  );
  const matrix = activities.map(() => activities.map(() => 0));
  if (edges.length === 0) {
    for (let position = 0; position < activities.length - 1; position += 1) {
      const row = matrix[position];
      if (row) {
        row[position + 1] = 1;
      }
    }
    return matrix;
  }
  for (const edge of edges) {
    const from = index.get(edge.from_slug);
    const to = index.get(edge.to_slug);
    if (from === undefined || to === undefined) {
      continue;
    }
    const row = matrix[from];
    if (row) {
      row[to] = edge.probability;
    }
  }
  return matrix;
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
          return [];
        }
        return [
          {
            fromActivityId: activityId(from.slug),
            observedOccurrences: 0 as const,
            observedSupport: 0 as const,
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
    workflowId: workflow.id,
  };
}

export function designedGraphFor(kb: TenantKb, workflowId: string) {
  const workflow = kb.workflows.find((item) => item.id === workflowId);
  return workflow ? buildDesignedGraph(workflow) : null;
}

export function emptyTenantKb(workspaceId: string): TenantKb {
  return {
    people: [],
    policies: [],
    projects: [],
    roleCapabilities: [],
    roles: [],
    workflows: [],
    workspaceId,
  };
}

export async function readTenantKb(
  db: D1Database,
  workspaceId: string
): Promise<TenantKb> {
  const [
    projects,
    workflows,
    activities,
    edges,
    policies,
    people,
    roles,
    repertoires,
  ] = await Promise.all([
    db
      .prepare(
        `SELECT id, name, summary, spec_md, constraints_json, workflow_id
           FROM tenant_project WHERE workspace_id = ? ORDER BY name, id`
      )
      .bind(workspaceId)
      .all<ProjectRow>(),
    db
      .prepare(
        `SELECT id, project_id, name, entry_slug, exit_slugs_json
           FROM tenant_workflow WHERE workspace_id = ? ORDER BY id`
      )
      .bind(workspaceId)
      .all<WorkflowRow>(),
    db
      .prepare(
        `SELECT workflow_id, slug, label, role_expected, rank, synonyms_json
           FROM tenant_activity WHERE workspace_id = ?
           ORDER BY workflow_id, rank, slug`
      )
      .bind(workspaceId)
      .all<ActivityRow>(),
    db
      .prepare(
        `SELECT workflow_id, from_slug, to_slug, probability
           FROM tenant_edge WHERE workspace_id = ?
           ORDER BY workflow_id, from_slug, to_slug`
      )
      .bind(workspaceId)
      .all<EdgeRow>(),
    db
      .prepare(
        `SELECT id, project_id, kind, activity_slug, text, params_json
           FROM tenant_policy WHERE workspace_id = ? ORDER BY id`
      )
      .bind(workspaceId)
      .all<PolicyRow>(),
    db
      .prepare(
        `SELECT person_id, display_name, real_name, title, role_id, color
           FROM tenant_person WHERE workspace_id = ? AND deleted = 0
           ORDER BY real_name, person_id`
      )
      .bind(workspaceId)
      .all<PersonRow>(),
    db
      .prepare(
        "SELECT id, name FROM tenant_role WHERE workspace_id = ? ORDER BY name, id"
      )
      .bind(workspaceId)
      .all<RoleRow>(),
    db
      .prepare(
        `SELECT role_id, activity_slug, relation
           FROM tenant_role_repertoire WHERE workspace_id = ?
           ORDER BY role_id, activity_slug`
      )
      .bind(workspaceId)
      .all<RepertoireRow>(),
  ]);

  const activitiesByWorkflow = new Map<string, ActivityDefinition[]>();
  for (const row of activities.results) {
    const list = activitiesByWorkflow.get(row.workflow_id) ?? [];
    list.push({
      label: row.label,
      role: row.role_expected ?? "",
      slug: row.slug,
      synonyms: parseJsonArray(row.synonyms_json),
    });
    activitiesByWorkflow.set(row.workflow_id, list);
  }
  const edgesByWorkflow = new Map<string, EdgeRow[]>();
  for (const row of edges.results) {
    const list = edgesByWorkflow.get(row.workflow_id) ?? [];
    list.push(row);
    edgesByWorkflow.set(row.workflow_id, list);
  }
  const policyIdsByWorkflow = new Map<string, string[]>();
  const projectWorkflow = new Map(
    workflows.results.map((row) => [row.project_id, row.id])
  );
  for (const row of policies.results) {
    const workflowId = projectWorkflow.get(row.project_id);
    if (!workflowId) {
      continue;
    }
    const list = policyIdsByWorkflow.get(workflowId) ?? [];
    list.push(row.id);
    policyIdsByWorkflow.set(workflowId, list);
  }

  const repertoireByRole = new Map<
    string,
    { never_performs: string[]; performs: string[] }
  >();
  for (const row of repertoires.results) {
    const entry = repertoireByRole.get(row.role_id) ?? {
      never_performs: [],
      performs: [],
    };
    entry[row.relation].push(activityId(row.activity_slug));
    repertoireByRole.set(row.role_id, entry);
  }

  const projectIdsByPerson = new Map<string, string[]>();
  const allProjectIds = projects.results.map((row) => row.id);

  return {
    people: people.results.map((row) => ({
      biases: [],
      color: row.color,
      comms_style: "",
      emoji: "",
      goals: [],
      id: row.person_id,
      name: row.real_name || row.display_name,
      // Slack membership is channel-level, so a resolved person is visible to
      // every project in the workspace until roles narrow it.
      projects: projectIdsByPerson.get(row.person_id) ?? allProjectIds,
      role: row.role_id ?? "",
      seniority: row.title,
    })),
    policies: policies.results.map((row) => ({
      activity_slug: row.activity_slug,
      id: row.id,
      kind: row.kind,
      params: parseJsonObject(row.params_json),
      project_id: row.project_id,
      text: row.text,
    })),
    projects: projects.results.map((row) => ({
      constraints: parseJsonArray(row.constraints_json),
      id: row.id,
      name: row.name,
      spec_md: row.spec_md,
      summary: row.summary,
      workflow_id: row.workflow_id ?? projectWorkflow.get(row.id) ?? "",
    })),
    roleCapabilities: [...repertoireByRole.entries()].map(([role, entry]) => ({
      never_performs: entry.never_performs,
      performs: entry.performs,
      role,
    })),
    roles: roles.results.map((row) => ({ id: row.id, name: row.name })),
    workflows: workflows.results.map((row) => {
      const workflowActivities = activitiesByWorkflow.get(row.id) ?? [];
      return {
        activities: workflowActivities,
        entry_activity: row.entry_slug,
        exit_activities: parseJsonArray(row.exit_slugs_json),
        id: row.id,
        matrix: buildMatrix(
          workflowActivities,
          edgesByWorkflow.get(row.id) ?? []
        ),
        name: row.name,
        policy_ids: policyIdsByWorkflow.get(row.id) ?? [],
        project_id: row.project_id,
      };
    }),
    workspaceId,
  };
}
