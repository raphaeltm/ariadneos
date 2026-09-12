import { describe, expect, it } from "vitest";
import type {
  DesignedWorkflowInput,
  MiningStepInput,
} from "../shared/mining/graph.ts";
import {
  applyDesignedGraphEdits,
  type DesignedGraphEdit,
  rewriteStepForDesignedEdits,
} from "../shared/model-edits.ts";

const baseWorkflow: DesignedWorkflowInput = {
  activities: [
    { id: "act_alpha", label: "Alpha", rank: 0, slug: "alpha" },
    { id: "act_beta", label: "Beta", rank: 1, slug: "beta" },
    { id: "act_gamma", label: "Gamma", rank: 2, slug: "gamma" },
  ],
  edges: [
    {
      probability: 1,
      sourceActivityId: "act_alpha",
      targetActivityId: "act_beta",
    },
  ],
  entryActivitySlug: "alpha",
  exitActivitySlugs: ["gamma"],
  id: "wf_test",
  name: "Test workflow",
  projectId: "proj_test",
};

describe("designed graph edit reducer", () => {
  it("reduces node and edge edits into an effective designed workflow", () => {
    const result = applyDesignedGraphEdits(baseWorkflow, [
      edit(1, "add_node", { rank: 1, slug: "delta" }),
      edit(2, "rename_node", { label: "Delta review", slug: "delta" }),
      edit(3, "add_edge", {
        from_slug: "delta",
        kind: "approval",
        probability: 2,
        to_slug: "gamma",
      }),
      edit(4, "add_edge", {
        from_slug: "delta",
        probability: 0.4,
        to_slug: "gamma",
      }),
      edit(5, "remove_edge", { from_slug: "alpha", to_slug: "beta" }),
      edit(6, "merge_nodes", {
        label: "Gamma combined",
        source_slug: "delta",
        target_slug: "gamma",
      }),
      edit(7, "remove_node", { slug: "alpha" }),
      edit(8, "add_node", { slug: "ignored" }, true),
    ]);

    expect(result.workflow.activities.map((activity) => activity.slug)).toEqual(
      ["beta", "gamma"]
    );
    expect(
      result.workflow.activities.find((activity) => activity.slug === "gamma")
    ).toMatchObject({ label: "Gamma combined", rank: 1 });
    expect(result.workflow.edges).toEqual([]);
    expect(result.workflow.entryActivitySlug).toBe("beta");
    expect(result.workflow.matrix).toEqual([
      [0, 0],
      [0, 0],
    ]);
    expect(result.mergedSlugs).toEqual({ delta: "gamma" });

    const rewritten = rewriteStepForDesignedEdits(
      step("delta"),
      result.mergedSlugs
    );
    expect(rewritten).toMatchObject({
      activityId: "act_gamma",
      activityLabel: "Gamma",
      activitySlug: "gamma",
    });
    const unchanged = step("beta");
    expect(rewriteStepForDesignedEdits(unchanged, result.mergedSlugs)).toBe(
      unchanged
    );
  });

  it("treats invalid reducer inputs as no-ops", () => {
    const result = applyDesignedGraphEdits(baseWorkflow, [
      edit(1, "add_node", { slug: "alpha" }),
      edit(2, "remove_node", { slug: "missing" }),
      edit(3, "rename_node", { label: "Missing", slug: "missing" }),
      edit(4, "rename_node", { label: "   ", slug: "alpha" }),
      edit(5, "merge_nodes", { source_slug: "alpha", target_slug: "alpha" }),
      edit(6, "merge_nodes", { source_slug: "missing", target_slug: "beta" }),
      edit(7, "add_edge", { from_slug: "alpha", to_slug: "alpha" }),
      edit(8, "add_edge", { from_slug: "missing", to_slug: "beta" }),
      edit(9, "remove_edge", { from_slug: "beta", to_slug: "gamma" }),
    ]);

    expect(result.workflow.activities.map((activity) => activity.slug)).toEqual(
      ["alpha", "beta", "gamma"]
    );
    expect(result.workflow.edges).toHaveLength(1);
    expect(result.mergedSlugs).toEqual({});
  });
});

function edit(
  revision: number,
  action: DesignedGraphEdit["action"],
  payload: DesignedGraphEdit["payload"],
  undone = false
): DesignedGraphEdit {
  return {
    action,
    id: `edit_${revision}`,
    payload,
    revision,
    undone,
  };
}

function step(slug: string): MiningStepInput {
  return {
    activitySlug: slug,
    id: `stp_${slug}`,
    seq: 1,
    sessionId: "ses_test",
    type: "action",
  };
}
