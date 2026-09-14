// Validation and persistence for workspace-authored process definitions.
//
// Input arrives from an authenticated setup UI, so it is treated as untrusted:
// slugs, ids and lengths are checked here rather than relying on the TypeScript
// shape of the request body.

import type { PolicyKind } from "./kb.ts";

const ID_PATTERN = /^[a-z][a-z0-9_]{1,48}$/;
const SLUG_PATTERN = /^[a-z][a-z0-9_]{2,40}$/;
const POLICY_KINDS = new Set<PolicyKind>([
  "approval",
  "mandatory",
  "ordering",
  "threshold",
]);
const MAX_ACTIVITIES = 60;
const MAX_LABEL = 120;
const MAX_TEXT = 2000;
const PROJECT_ID_PATTERN = /^proj_[a-z][a-z0-9_]{1,43}$/;
const WORKFLOW_ID_PATTERN = /^wf_[a-z][a-z0-9_]{1,45}$/;
const POLICY_ID_PATTERN = /^pol_[a-z][a-z0-9_]{1,45}$/;
const PROJECT_ID_PREFIX = /^proj_/;
const NON_SLUG_CHARS = /[^a-z0-9]+/g;
const EDGE_UNDERSCORES = /^_+|_+$/g;
const LEADING_LETTER = /^[a-z]/;

export interface AuthoringError {
  field: string;
  message: string;
}

export interface ActivityInput {
  label: string;
  role: string | null;
  slug: string;
  synonyms: string[];
}

export interface WorkflowInput {
  activities: ActivityInput[];
  edges: Array<{ from: string; probability: number; to: string }>;
  entry_slug: string;
  exit_slugs: string[];
  id: string;
  name: string;
  project_id: string;
}

export interface ProjectInput {
  constraints: string[];
  id: string;
  name: string;
  spec_md: string;
  summary: string;
}

export interface PolicyInput {
  activity_slug: string;
  id: string;
  kind: PolicyKind;
  params: Record<string, unknown>;
  project_id: string;
  text: string;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readTrimmed(value: unknown, max: number) {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  return trimmed && trimmed.length <= max ? trimmed : null;
}

function readStringArray(value: unknown, max: number) {
  if (!Array.isArray(value)) {
    return [];
  }
  return value
    .map((item) => readTrimmed(item, max))
    .filter((item): item is string => item !== null)
    .slice(0, 40);
}

/** Derives a slug from a human label so the setup UI can accept plain text. */
export function slugify(label: string) {
  const slug = label
    .toLowerCase()
    .replaceAll(NON_SLUG_CHARS, "_")
    .replaceAll(EDGE_UNDERSCORES, "")
    .slice(0, 40);
  if (!slug) {
    return null;
  }
  const prefixed = LEADING_LETTER.test(slug) ? slug : `a_${slug}`;
  return SLUG_PATTERN.test(prefixed) ? prefixed : null;
}

export function parseProjectInput(
  body: unknown
): { errors: AuthoringError[] } | { value: ProjectInput } {
  const errors: AuthoringError[] = [];
  if (!isObject(body)) {
    return {
      errors: [{ field: "body", message: "A JSON object is required." }],
    };
  }
  const name = readTrimmed(body.name, MAX_LABEL);
  if (!name) {
    errors.push({
      field: "name",
      message: "Enter a project name from 1 to 120 characters.",
    });
  }
  const explicitId = body.id === undefined ? null : readTrimmed(body.id, 50);
  const derived = name ? slugify(name) : null;
  const id = explicitId ?? (derived ? `proj_${derived}`.slice(0, 50) : null);
  if (!(id && PROJECT_ID_PATTERN.test(id))) {
    errors.push({
      field: "id",
      message: "Project id must look like proj_my_project.",
    });
  }
  if (errors.length || !(id && name)) {
    return { errors };
  }
  return {
    value: {
      constraints: readStringArray(body.constraints, MAX_TEXT),
      id,
      name,
      spec_md: readTrimmed(body.spec_md, 20_000) ?? "",
      summary: readTrimmed(body.summary, MAX_TEXT) ?? "",
    },
  };
}

function parseActivities(raw: unknown, errors: AuthoringError[]) {
  if (!Array.isArray(raw) || raw.length === 0) {
    errors.push({
      field: "activities",
      message: "Add at least one activity to the workflow.",
    });
    return [];
  }
  if (raw.length > MAX_ACTIVITIES) {
    errors.push({
      field: "activities",
      message: `A workflow can hold at most ${MAX_ACTIVITIES} activities.`,
    });
    return [];
  }
  const activities: ActivityInput[] = [];
  const seen = new Set<string>();
  for (const [index, entry] of raw.entries()) {
    if (!isObject(entry)) {
      errors.push({
        field: `activities.${index}`,
        message: "Each activity must be an object.",
      });
      continue;
    }
    const label = readTrimmed(entry.label, MAX_LABEL);
    if (!label) {
      errors.push({
        field: `activities.${index}.label`,
        message: "Enter an activity label from 1 to 120 characters.",
      });
      continue;
    }
    const slug =
      (entry.slug === undefined ? null : readTrimmed(entry.slug, 40)) ??
      slugify(label);
    if (!(slug && SLUG_PATTERN.test(slug))) {
      errors.push({
        field: `activities.${index}.slug`,
        message:
          "Activity slug must be 3 to 41 lowercase letters, digits or underscores.",
      });
      continue;
    }
    if (seen.has(slug)) {
      errors.push({
        field: `activities.${index}.slug`,
        message: `Activity slug ${slug} is duplicated.`,
      });
      continue;
    }
    seen.add(slug);
    activities.push({
      label,
      role: entry.role === undefined ? null : readTrimmed(entry.role, 50),
      slug,
      synonyms: readStringArray(entry.synonyms, MAX_LABEL),
    });
  }
  return activities;
}

function parseEdges(
  raw: unknown,
  slugs: ReadonlySet<string>,
  errors: AuthoringError[]
) {
  if (raw === undefined || raw === null) {
    return [];
  }
  if (!Array.isArray(raw)) {
    errors.push({ field: "edges", message: "edges must be an array." });
    return [];
  }
  const edges: Array<{ from: string; probability: number; to: string }> = [];
  for (const [index, entry] of raw.entries()) {
    if (!isObject(entry)) {
      errors.push({
        field: `edges.${index}`,
        message: "Each edge must be an object.",
      });
      continue;
    }
    const from = readTrimmed(entry.from, 40);
    const to = readTrimmed(entry.to, 40);
    if (!(from && to && slugs.has(from) && slugs.has(to))) {
      errors.push({
        field: `edges.${index}`,
        message: "Edge endpoints must be activity slugs in this workflow.",
      });
      continue;
    }
    const probability =
      typeof entry.probability === "number" &&
      Number.isFinite(entry.probability)
        ? Math.min(Math.max(entry.probability, 0), 1)
        : 1;
    if (probability === 0) {
      continue;
    }
    edges.push({ from, probability, to });
  }
  return edges;
}

export function parseWorkflowInput(
  body: unknown
): { errors: AuthoringError[] } | { value: WorkflowInput } {
  const errors: AuthoringError[] = [];
  if (!isObject(body)) {
    return {
      errors: [{ field: "body", message: "A JSON object is required." }],
    };
  }
  const name = readTrimmed(body.name, MAX_LABEL);
  if (!name) {
    errors.push({
      field: "name",
      message: "Enter a workflow name from 1 to 120 characters.",
    });
  }
  const projectId = readTrimmed(body.project_id, 50);
  if (
    !(
      projectId &&
      PROJECT_ID_PREFIX.test(projectId) &&
      ID_PATTERN.test(projectId.slice(5))
    )
  ) {
    errors.push({ field: "project_id", message: "Choose a project." });
  }
  const explicitId = body.id === undefined ? null : readTrimmed(body.id, 50);
  const derived = name ? slugify(name) : null;
  const id = explicitId ?? (derived ? `wf_${derived}`.slice(0, 50) : null);
  if (!(id && WORKFLOW_ID_PATTERN.test(id))) {
    errors.push({
      field: "id",
      message: "Workflow id must look like wf_my_workflow.",
    });
  }
  const activities = parseActivities(body.activities, errors);
  const slugs = new Set(activities.map((activity) => activity.slug));
  const edges = parseEdges(body.edges, slugs, errors);
  const entrySlug =
    (body.entry_slug === undefined ? null : readTrimmed(body.entry_slug, 40)) ??
    activities[0]?.slug ??
    null;
  if (!(entrySlug && slugs.has(entrySlug))) {
    errors.push({
      field: "entry_slug",
      message: "The entry activity must be one of the workflow activities.",
    });
  }
  const requestedExits = readStringArray(body.exit_slugs, 40).filter((slug) =>
    slugs.has(slug)
  );
  const exitSlugs = requestedExits.length
    ? requestedExits
    : activities.slice(-1).map((activity) => activity.slug);
  if (errors.length || !(id && name && projectId && entrySlug)) {
    return { errors };
  }
  return {
    value: {
      activities,
      edges,
      entry_slug: entrySlug,
      exit_slugs: exitSlugs,
      id,
      name,
      project_id: projectId,
    },
  };
}

export function parsePolicyInput(
  body: unknown
): { errors: AuthoringError[] } | { value: PolicyInput } {
  const errors: AuthoringError[] = [];
  if (!isObject(body)) {
    return {
      errors: [{ field: "body", message: "A JSON object is required." }],
    };
  }
  const text = readTrimmed(body.text, MAX_TEXT);
  if (!text) {
    errors.push({
      field: "text",
      message: "Enter the policy text, up to 2000 characters.",
    });
  }
  const projectId = readTrimmed(body.project_id, 50);
  if (!projectId?.startsWith("proj_")) {
    errors.push({ field: "project_id", message: "Choose a project." });
  }
  const activitySlug = readTrimmed(body.activity_slug, 40);
  if (!(activitySlug && SLUG_PATTERN.test(activitySlug))) {
    errors.push({
      field: "activity_slug",
      message: "Choose the activity the policy governs.",
    });
  }
  const kind = readTrimmed(body.kind, 20);
  if (!(kind && POLICY_KINDS.has(kind as PolicyKind))) {
    errors.push({
      field: "kind",
      message: "kind must be approval, mandatory, ordering or threshold.",
    });
  }
  const explicitId = body.id === undefined ? null : readTrimmed(body.id, 50);
  const id =
    explicitId ??
    (activitySlug && kind ? `pol_${activitySlug}_${kind}`.slice(0, 50) : null);
  if (!(id && POLICY_ID_PATTERN.test(id))) {
    errors.push({
      field: "id",
      message: "Policy id must look like pol_my_policy.",
    });
  }
  if (errors.length || !(id && text && projectId && activitySlug && kind)) {
    return { errors };
  }
  return {
    value: {
      activity_slug: activitySlug,
      id,
      kind: kind as PolicyKind,
      params: isObject(body.params) ? body.params : {},
      project_id: projectId,
      text,
    },
  };
}

export async function saveProject(
  db: D1Database,
  workspaceId: string,
  project: ProjectInput,
  now = new Date().toISOString()
) {
  await db
    .prepare(
      `INSERT INTO tenant_project
       (workspace_id, id, name, summary, spec_md, constraints_json, workflow_id,
        created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, NULL, ?, ?)
       ON CONFLICT(workspace_id, id) DO UPDATE SET
         name = excluded.name,
         summary = excluded.summary,
         spec_md = excluded.spec_md,
         constraints_json = excluded.constraints_json,
         updated_at = excluded.updated_at`
    )
    .bind(
      workspaceId,
      project.id,
      project.name,
      project.summary,
      project.spec_md,
      JSON.stringify(project.constraints),
      now,
      now
    )
    .run();
}

export async function saveWorkflow(
  db: D1Database,
  workspaceId: string,
  workflow: WorkflowInput,
  now = new Date().toISOString()
) {
  const statements = [
    db
      .prepare(
        `INSERT INTO tenant_workflow
         (workspace_id, id, project_id, name, entry_slug, exit_slugs_json,
          created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(workspace_id, id) DO UPDATE SET
           project_id = excluded.project_id,
           name = excluded.name,
           entry_slug = excluded.entry_slug,
           exit_slugs_json = excluded.exit_slugs_json,
           updated_at = excluded.updated_at`
      )
      .bind(
        workspaceId,
        workflow.id,
        workflow.project_id,
        workflow.name,
        workflow.entry_slug,
        JSON.stringify(workflow.exit_slugs),
        now,
        now
      ),
    // Replace the activity and edge set wholesale: a removed activity must not
    // linger in the designed plane after the workflow is re-saved.
    db
      .prepare(
        "DELETE FROM tenant_activity WHERE workspace_id = ? AND workflow_id = ?"
      )
      .bind(workspaceId, workflow.id),
    db
      .prepare(
        "DELETE FROM tenant_edge WHERE workspace_id = ? AND workflow_id = ?"
      )
      .bind(workspaceId, workflow.id),
    ...workflow.activities.map((activity, rank) =>
      db
        .prepare(
          `INSERT INTO tenant_activity
           (workspace_id, workflow_id, slug, label, description, role_expected,
            rank, synonyms_json)
           VALUES (?, ?, ?, ?, '', ?, ?, ?)`
        )
        .bind(
          workspaceId,
          workflow.id,
          activity.slug,
          activity.label,
          activity.role,
          rank,
          JSON.stringify(activity.synonyms)
        )
    ),
    ...workflow.edges.map((edge) =>
      db
        .prepare(
          `INSERT INTO tenant_edge
           (workspace_id, workflow_id, from_slug, to_slug, probability)
           VALUES (?, ?, ?, ?, ?)`
        )
        .bind(workspaceId, workflow.id, edge.from, edge.to, edge.probability)
    ),
    db
      .prepare(
        `UPDATE tenant_project SET workflow_id = ?, updated_at = ?
         WHERE workspace_id = ? AND id = ?`
      )
      .bind(workflow.id, now, workspaceId, workflow.project_id),
  ];
  await db.batch(statements);
}

export async function savePolicy(
  db: D1Database,
  workspaceId: string,
  policy: PolicyInput,
  now = new Date().toISOString()
) {
  await db
    .prepare(
      `INSERT INTO tenant_policy
       (workspace_id, id, project_id, workflow_id, kind, activity_slug, text,
        params_json, created_at)
       VALUES (?, ?, ?, NULL, ?, ?, ?, ?, ?)
       ON CONFLICT(workspace_id, id) DO UPDATE SET
         project_id = excluded.project_id,
         kind = excluded.kind,
         activity_slug = excluded.activity_slug,
         text = excluded.text,
         params_json = excluded.params_json`
    )
    .bind(
      workspaceId,
      policy.id,
      policy.project_id,
      policy.kind,
      policy.activity_slug,
      policy.text,
      JSON.stringify(policy.params),
      now
    )
    .run();
}

export async function deletePolicy(
  db: D1Database,
  workspaceId: string,
  policyId: string
) {
  const result = await db
    .prepare("DELETE FROM tenant_policy WHERE workspace_id = ? AND id = ?")
    .bind(workspaceId, policyId)
    .run();
  return (result.meta?.changes ?? 0) > 0;
}

export async function saveRole(
  db: D1Database,
  workspaceId: string,
  role: { id: string; name: string }
) {
  await db
    .prepare(
      `INSERT INTO tenant_role (workspace_id, id, name) VALUES (?, ?, ?)
       ON CONFLICT(workspace_id, id) DO UPDATE SET name = excluded.name`
    )
    .bind(workspaceId, role.id, role.name)
    .run();
}

/**
 * Derives the role repertoire from the workflow: a role is expected to perform
 * the activities its workflow assigns it. Roles are created on demand so the
 * setup UI only has to name them on an activity.
 */
export async function syncRolesFromWorkflow(
  db: D1Database,
  workspaceId: string,
  workflow: WorkflowInput
) {
  const roles = new Map<string, string[]>();
  for (const activity of workflow.activities) {
    if (!activity.role) {
      continue;
    }
    const roleId = slugify(activity.role);
    if (!roleId) {
      continue;
    }
    const slugs = roles.get(roleId) ?? [];
    slugs.push(activity.slug);
    roles.set(roleId, slugs);
  }
  if (roles.size === 0) {
    return;
  }
  const labels = new Map(
    workflow.activities
      .filter((activity) => activity.role)
      .map((activity) => [
        slugify(activity.role ?? "") ?? "",
        activity.role ?? "",
      ])
  );
  await db.batch([
    ...[...roles.keys()].map((roleId) =>
      db
        .prepare(
          `INSERT INTO tenant_role (workspace_id, id, name) VALUES (?, ?, ?)
           ON CONFLICT(workspace_id, id) DO UPDATE SET name = excluded.name`
        )
        .bind(workspaceId, roleId, labels.get(roleId) ?? roleId)
    ),
    ...[...roles.keys()].map((roleId) =>
      db
        .prepare(
          `DELETE FROM tenant_role_repertoire
           WHERE workspace_id = ? AND role_id = ? AND relation = 'performs'`
        )
        .bind(workspaceId, roleId)
    ),
    ...[...roles.entries()].flatMap(([roleId, slugs]) =>
      slugs.map((slug) =>
        db
          .prepare(
            `INSERT INTO tenant_role_repertoire
             (workspace_id, role_id, activity_slug, relation)
             VALUES (?, ?, ?, 'performs')
             ON CONFLICT(workspace_id, role_id, activity_slug, relation) DO NOTHING`
          )
          .bind(workspaceId, roleId, slug)
      )
    ),
  ]);
}

/**
 * Normalises an activity role name to the role id used in the repertoire, so the
 * caller can map an authored role label onto stored capability rows.
 */
export function roleIdFor(role: string | null) {
  return role ? slugify(role) : null;
}
