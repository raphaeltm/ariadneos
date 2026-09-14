import type { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  type ActivityInput,
  deletePolicy,
  type PolicyInput,
  parsePolicyInput,
  parseProjectInput,
  parseWorkflowInput,
  savePolicy,
  saveProject,
  saveWorkflow,
  syncRolesFromWorkflow,
  type WorkflowInput,
} from "../server/tenant/authoring.ts";
import {
  createTestDatabase,
  type SqliteD1,
  TEST_WORKSPACE,
} from "./helpers/tenant.ts";

let sqlite: DatabaseSync;
let d1: SqliteD1;
let db: D1Database;

beforeEach(() => {
  ({ d1, sqlite } = createTestDatabase());
  db = d1 as unknown as D1Database;
});

afterEach(() => {
  sqlite.close();
});

function activity(
  overrides: Partial<ActivityInput> & { label: string }
): unknown {
  return {
    role: null,
    synonyms: [],
    ...overrides,
  };
}

describe("parseProjectInput", () => {
  it("derives a slug id from the project name", () => {
    const parsed = parseProjectInput({ name: "Customer Onboarding" });
    expect(parsed).toHaveProperty("value.id", "proj_customer_onboarding");
  });

  it("uses an explicit id instead of deriving one", () => {
    const parsed = parseProjectInput({
      id: "proj_custom_id",
      name: "Anything",
    });
    expect(parsed).toHaveProperty("value.id", "proj_custom_id");
  });

  it("rejects a malformed explicit id", () => {
    const parsed = parseProjectInput({ id: "proj_Bad-ID!", name: "Anything" });
    expect(
      "errors" in parsed && parsed.errors.map((error) => error.field)
    ).toContain("id");
  });

  it("rejects a missing name", () => {
    const parsed = parseProjectInput({});
    expect(
      "errors" in parsed && parsed.errors.map((error) => error.field)
    ).toContain("name");
  });

  it("rejects a non-object body", () => {
    const parsed = parseProjectInput("not an object");
    expect("errors" in parsed && parsed.errors[0]?.field).toBe("body");
  });
});

describe("parseWorkflowInput: slugify behaviour", () => {
  it("derives a valid activity slug from a plain label", () => {
    const parsed = parseWorkflowInput({
      activities: [activity({ label: "Detect Incident" })],
      name: "Incident response",
      project_id: "proj_checkout",
    });
    expect("value" in parsed && parsed.value.activities[0]?.slug).toBe(
      "detect_incident"
    );
  });

  it("prefixes a slug that would otherwise start with a digit", () => {
    const parsed = parseWorkflowInput({
      activities: [activity({ label: "2026 Roadmap Review" })],
      name: "Planning",
      project_id: "proj_checkout",
    });
    expect("value" in parsed && parsed.value.activities[0]?.slug).toBe(
      "a_2026_roadmap_review"
    );
  });

  // A label made entirely of punctuation collapses to nothing once non-slug
  // characters are stripped; the parser must reject it rather than silently
  // dropping the activity or crashing on a null slug.
  it("rejects an activity label that cannot be turned into a slug", () => {
    const parsed = parseWorkflowInput({
      activities: [activity({ label: "!!!" })],
      name: "Broken",
      project_id: "proj_checkout",
    });
    expect(
      "errors" in parsed && parsed.errors.map((error) => error.field)
    ).toContain("activities.0.slug");
  });
});

describe("parseWorkflowInput: ids", () => {
  it("derives the workflow id from the name", () => {
    const parsed = parseWorkflowInput({
      activities: [activity({ label: "Step one" })],
      name: "Incident Response",
      project_id: "proj_checkout",
    });
    expect("value" in parsed && parsed.value.id).toBe("wf_incident_response");
  });

  it("uses an explicit workflow id when supplied", () => {
    const parsed = parseWorkflowInput({
      activities: [activity({ label: "Step one" })],
      id: "wf_custom",
      name: "Incident Response",
      project_id: "proj_checkout",
    });
    expect("value" in parsed && parsed.value.id).toBe("wf_custom");
  });

  it("rejects a malformed explicit workflow id", () => {
    const parsed = parseWorkflowInput({
      activities: [activity({ label: "Step one" })],
      id: "not-valid",
      name: "Incident Response",
      project_id: "proj_checkout",
    });
    expect(
      "errors" in parsed && parsed.errors.map((error) => error.field)
    ).toContain("id");
  });

  it("rejects a project_id that isn't a proj_ id", () => {
    const parsed = parseWorkflowInput({
      activities: [activity({ label: "Step one" })],
      name: "Incident Response",
      project_id: "not_a_project",
    });
    expect(
      "errors" in parsed && parsed.errors.map((error) => error.field)
    ).toContain("project_id");
  });
});

describe("parseWorkflowInput: activity validation", () => {
  it("requires at least one activity", () => {
    const parsed = parseWorkflowInput({
      activities: [],
      name: "Empty",
      project_id: "proj_checkout",
    });
    expect(
      "errors" in parsed && parsed.errors.map((error) => error.field)
    ).toContain("activities");
  });

  it("rejects a workflow with more than 60 activities", () => {
    const activities = Array.from({ length: 61 }, (_, index) =>
      activity({ label: `Activity ${index}` })
    );
    const parsed = parseWorkflowInput({
      activities,
      name: "Too many",
      project_id: "proj_checkout",
    });
    expect(
      "errors" in parsed && parsed.errors.map((error) => error.field)
    ).toContain("activities");
  });

  it("rejects a duplicate activity slug", () => {
    const parsed = parseWorkflowInput({
      activities: [
        activity({ label: "First", slug: "step_one" }),
        activity({ label: "Second", slug: "step_one" }),
      ],
      name: "Duplicate",
      project_id: "proj_checkout",
    });
    expect(
      "errors" in parsed &&
        parsed.errors.some(
          (error) =>
            error.field === "activities.1.slug" &&
            error.message.includes("duplicated")
        )
    ).toBe(true);
  });
});

describe("parseWorkflowInput: edges", () => {
  const twoActivities = [
    activity({ label: "Step one", slug: "step_one" }),
    activity({ label: "Step two", slug: "step_two" }),
  ];

  it("rejects an edge whose endpoint is not an activity slug in this workflow", () => {
    const parsed = parseWorkflowInput({
      activities: twoActivities,
      edges: [{ from: "step_one", to: "not_a_real_step" }],
      name: "Bad edge",
      project_id: "proj_checkout",
    });
    expect(
      "errors" in parsed && parsed.errors.map((error) => error.field)
    ).toContain("edges.0");
  });

  it("drops a zero-probability edge instead of persisting a dead edge", () => {
    const parsed = parseWorkflowInput({
      activities: twoActivities,
      edges: [{ from: "step_one", probability: 0, to: "step_two" }],
      name: "Zero edge",
      project_id: "proj_checkout",
    });
    expect("value" in parsed && parsed.value.edges).toEqual([]);
  });

  it("clamps an edge probability above 1 down to 1", () => {
    const parsed = parseWorkflowInput({
      activities: twoActivities,
      edges: [{ from: "step_one", probability: 5, to: "step_two" }],
      name: "Clamped edge",
      project_id: "proj_checkout",
    });
    expect("value" in parsed && parsed.value.edges).toEqual([
      { from: "step_one", probability: 1, to: "step_two" },
    ]);
  });

  it("clamps a negative edge probability to zero, which then drops the edge", () => {
    const parsed = parseWorkflowInput({
      activities: twoActivities,
      edges: [{ from: "step_one", probability: -5, to: "step_two" }],
      name: "Negative edge",
      project_id: "proj_checkout",
    });
    expect("value" in parsed && parsed.value.edges).toEqual([]);
  });
});

describe("parseWorkflowInput: entry and exit", () => {
  const threeActivities = [
    activity({ label: "Step one", slug: "step_one" }),
    activity({ label: "Step two", slug: "step_two" }),
    activity({ label: "Step three", slug: "step_three" }),
  ];

  it("requires entry_slug to be one of the workflow's own activities", () => {
    const parsed = parseWorkflowInput({
      activities: threeActivities,
      entry_slug: "not_one_of_them",
      name: "Bad entry",
      project_id: "proj_checkout",
    });
    expect(
      "errors" in parsed && parsed.errors.map((error) => error.field)
    ).toContain("entry_slug");
  });

  it("defaults exit_slugs to the last activity when none are supplied", () => {
    const parsed = parseWorkflowInput({
      activities: threeActivities,
      name: "Default exit",
      project_id: "proj_checkout",
    });
    expect("value" in parsed && parsed.value.exit_slugs).toEqual([
      "step_three",
    ]);
  });
});

describe("parsePolicyInput", () => {
  it("derives the policy id from the activity slug and kind", () => {
    const parsed = parsePolicyInput({
      activity_slug: "security_review",
      kind: "mandatory",
      project_id: "proj_checkout",
      text: "A reviewer must sign off.",
    });
    expect("value" in parsed && parsed.value.id).toBe(
      "pol_security_review_mandatory"
    );
  });

  it("rejects an unknown policy kind", () => {
    const parsed = parsePolicyInput({
      activity_slug: "security_review",
      kind: "not_a_real_kind",
      project_id: "proj_checkout",
      text: "Text",
    });
    expect(
      "errors" in parsed && parsed.errors.map((error) => error.field)
    ).toContain("kind");
  });

  it("rejects a project_id that is not a proj_ id", () => {
    const parsed = parsePolicyInput({
      activity_slug: "security_review",
      kind: "mandatory",
      project_id: "checkout",
      text: "Text",
    });
    expect(
      "errors" in parsed && parsed.errors.map((error) => error.field)
    ).toContain("project_id");
  });

  it("rejects a malformed explicit policy id", () => {
    const parsed = parsePolicyInput({
      activity_slug: "security_review",
      id: "not-valid",
      kind: "mandatory",
      project_id: "proj_checkout",
      text: "Text",
    });
    expect(
      "errors" in parsed && parsed.errors.map((error) => error.field)
    ).toContain("id");
  });
});

function tenantActivityRows(workspaceId: string, workflowId: string) {
  return sqlite
    .prepare(
      "SELECT slug FROM tenant_activity WHERE workspace_id = ? AND workflow_id = ? ORDER BY rank"
    )
    .all(workspaceId, workflowId) as Array<{ slug: string }>;
}

function tenantEdgeRows(workspaceId: string, workflowId: string) {
  return sqlite
    .prepare(
      "SELECT from_slug, to_slug FROM tenant_edge WHERE workspace_id = ? AND workflow_id = ?"
    )
    .all(workspaceId, workflowId) as Array<{
    from_slug: string;
    to_slug: string;
  }>;
}

function workflowFrom(
  parsed: ReturnType<typeof parseWorkflowInput>
): WorkflowInput {
  if (!("value" in parsed)) {
    throw new Error("Expected a valid workflow fixture.");
  }
  return parsed.value;
}

describe("saveWorkflow replaces the activity and edge set", () => {
  it("removes an activity and its edges when the workflow is re-saved without it", async () => {
    await saveProject(db, TEST_WORKSPACE, {
      constraints: [],
      id: "proj_checkout",
      name: "Checkout",
      spec_md: "",
      summary: "",
    });
    const firstSave = workflowFrom(
      parseWorkflowInput({
        activities: [
          activity({ label: "Detect", slug: "detect" }),
          activity({ label: "Triage", slug: "triage" }),
          activity({ label: "Resolve", slug: "resolve" }),
        ],
        edges: [
          { from: "detect", to: "triage" },
          { from: "triage", to: "resolve" },
        ],
        id: "wf_incident",
        name: "Incident",
        project_id: "proj_checkout",
      })
    );
    await saveWorkflow(db, TEST_WORKSPACE, firstSave);
    expect(
      tenantActivityRows(TEST_WORKSPACE, "wf_incident").map((row) => row.slug)
    ).toEqual(["detect", "triage", "resolve"]);
    expect(tenantEdgeRows(TEST_WORKSPACE, "wf_incident")).toHaveLength(2);

    // Re-save the same workflow with "triage" dropped. A stale designed activity
    // left behind here would keep showing up on the process graph forever.
    const secondSave = workflowFrom(
      parseWorkflowInput({
        activities: [
          activity({ label: "Detect", slug: "detect" }),
          activity({ label: "Resolve", slug: "resolve" }),
        ],
        edges: [{ from: "detect", to: "resolve" }],
        id: "wf_incident",
        name: "Incident",
        project_id: "proj_checkout",
      })
    );
    await saveWorkflow(db, TEST_WORKSPACE, secondSave);

    const remainingActivities = tenantActivityRows(
      TEST_WORKSPACE,
      "wf_incident"
    );
    expect(remainingActivities.map((row) => row.slug)).toEqual([
      "detect",
      "resolve",
    ]);
    expect(remainingActivities.some((row) => row.slug === "triage")).toBe(
      false
    );

    const remainingEdges = tenantEdgeRows(TEST_WORKSPACE, "wf_incident");
    expect(remainingEdges).toEqual([
      { from_slug: "detect", to_slug: "resolve" },
    ]);
  });

  it("sets tenant_project.workflow_id to the saved workflow", async () => {
    await saveProject(db, TEST_WORKSPACE, {
      constraints: [],
      id: "proj_checkout",
      name: "Checkout",
      spec_md: "",
      summary: "",
    });
    const workflow = workflowFrom(
      parseWorkflowInput({
        activities: [activity({ label: "Step", slug: "step" })],
        id: "wf_flow",
        name: "Flow",
        project_id: "proj_checkout",
      })
    );
    await saveWorkflow(db, TEST_WORKSPACE, workflow);
    const project = sqlite
      .prepare(
        "SELECT workflow_id FROM tenant_project WHERE workspace_id = ? AND id = ?"
      )
      .get(TEST_WORKSPACE, "proj_checkout") as { workflow_id: string | null };
    expect(project.workflow_id).toBe("wf_flow");
  });
});

describe("syncRolesFromWorkflow", () => {
  function roleRows() {
    return sqlite
      .prepare(
        "SELECT id, name FROM tenant_role WHERE workspace_id = ? ORDER BY id"
      )
      .all(TEST_WORKSPACE) as Array<{ id: string; name: string }>;
  }
  function repertoireRows() {
    return sqlite
      .prepare(
        `SELECT role_id, activity_slug FROM tenant_role_repertoire
         WHERE workspace_id = ? AND relation = 'performs'
         ORDER BY role_id, activity_slug`
      )
      .all(TEST_WORKSPACE) as Array<{ activity_slug: string; role_id: string }>;
  }

  it("creates roles and 'performs' repertoire rows from the workflow's activity roles", async () => {
    const workflow = workflowFrom(
      parseWorkflowInput({
        activities: [
          activity({
            label: "Detect",
            role: "Support Engineer",
            slug: "detect",
          }),
          activity({
            label: "Deploy",
            role: "Backend Engineer",
            slug: "deploy",
          }),
          activity({
            label: "Approve",
            role: "Support Engineer",
            slug: "approve",
          }),
        ],
        id: "wf_flow",
        name: "Flow",
        project_id: "proj_checkout",
      })
    );
    await syncRolesFromWorkflow(db, TEST_WORKSPACE, workflow);
    expect(roleRows()).toEqual([
      { id: "backend_engineer", name: "Backend Engineer" },
      { id: "support_engineer", name: "Support Engineer" },
    ]);
    expect(repertoireRows()).toEqual([
      { activity_slug: "deploy", role_id: "backend_engineer" },
      { activity_slug: "approve", role_id: "support_engineer" },
      { activity_slug: "detect", role_id: "support_engineer" },
    ]);
  });

  it("is idempotent: running it again on the same workflow does not duplicate rows", async () => {
    const workflow = workflowFrom(
      parseWorkflowInput({
        activities: [
          activity({ label: "Detect", role: "Support", slug: "detect" }),
        ],
        id: "wf_flow",
        name: "Flow",
        project_id: "proj_checkout",
      })
    );
    await syncRolesFromWorkflow(db, TEST_WORKSPACE, workflow);
    await syncRolesFromWorkflow(db, TEST_WORKSPACE, workflow);
    expect(roleRows()).toHaveLength(1);
    expect(repertoireRows()).toHaveLength(1);
  });

  // The repertoire is derived from the current workflow, not accumulated: an
  // activity whose role assignment changed on re-save must not keep the old
  // role's repertoire entry around.
  it("drops a stale repertoire entry when an activity's role changes on re-sync", async () => {
    const firstWorkflow = workflowFrom(
      parseWorkflowInput({
        activities: [
          activity({ label: "Detect", role: "Support", slug: "detect" }),
          activity({ label: "Deploy", role: "Support", slug: "deploy" }),
        ],
        id: "wf_flow",
        name: "Flow",
        project_id: "proj_checkout",
      })
    );
    await syncRolesFromWorkflow(db, TEST_WORKSPACE, firstWorkflow);
    expect(repertoireRows()).toEqual([
      { activity_slug: "deploy", role_id: "support" },
      { activity_slug: "detect", role_id: "support" },
    ]);

    const secondWorkflow = workflowFrom(
      parseWorkflowInput({
        activities: [
          activity({ label: "Detect", role: "Support", slug: "detect" }),
          activity({ label: "Deploy", role: "Engineering", slug: "deploy" }),
        ],
        id: "wf_flow",
        name: "Flow",
        project_id: "proj_checkout",
      })
    );
    await syncRolesFromWorkflow(db, TEST_WORKSPACE, secondWorkflow);
    expect(repertoireRows()).toEqual([
      { activity_slug: "deploy", role_id: "engineering" },
      { activity_slug: "detect", role_id: "support" },
    ]);
  });
});

describe("deletePolicy", () => {
  const policy: PolicyInput = {
    activity_slug: "security_review",
    id: "pol_security_review_mandatory",
    kind: "mandatory",
    params: {},
    project_id: "proj_checkout",
    text: "A reviewer must sign off.",
  };

  it("returns false for an unknown policy id", async () => {
    const removed = await deletePolicy(
      db,
      TEST_WORKSPACE,
      "pol_does_not_exist"
    );
    expect(removed).toBe(false);
  });

  it("returns true and removes the row for a known policy id", async () => {
    await savePolicy(db, TEST_WORKSPACE, policy);
    const removed = await deletePolicy(db, TEST_WORKSPACE, policy.id);
    expect(removed).toBe(true);
    const row = sqlite
      .prepare("SELECT id FROM tenant_policy WHERE workspace_id = ? AND id = ?")
      .get(TEST_WORKSPACE, policy.id);
    expect(row).toBeUndefined();
  });
});
