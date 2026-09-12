import { describe, expect, it } from "vitest";
import { editableGraph, prepareGraphEdit } from "../shared/graph-edits.ts";
import type { GraphEdit, GraphEditAction } from "../shared/process.ts";
import { simulate } from "../shared/simulation.ts";

const events = simulate("vendor", 42, 24);

function edit(
  action: GraphEditAction,
  payload: Record<string, string>,
  index = 0,
  undone = false
): GraphEdit {
  return {
    action,
    actor: "test-user",
    createdAt: new Date(Date.UTC(2026, 8, 12, 14, index)).toISOString(),
    id: `edit-${index}`,
    payload,
    undone,
    workflow: "vendor",
  };
}

describe("graph edit projection", () => {
  it("promotes discovered nodes into the designed process", () => {
    const before = editableGraph(events, "vendor", []);
    expect(
      before.model.nodes.find((node) => node.id === "Changes requested")
    ).toMatchObject({ plane: "discovered" });

    const prepared = prepareGraphEdit({
      action: "promote",
      edits: [],
      events,
      payload: { id: "Changes requested" },
      workflow: "vendor",
    });
    expect(prepared).toEqual({
      action: "promote",
      payload: { id: "Changes requested" },
    });

    const after = editableGraph(events, "vendor", [
      edit("promote", { id: "Changes requested" }),
    ]);
    expect(
      after.model.nodes.find((node) => node.id === "Changes requested")
    ).toMatchObject({ plane: "both" });
    expect(
      after.conformance.extra.some((item) => item.slug === "Changes requested")
    ).toBe(false);
  });

  it("adds and removes nodes and edges as active edits", () => {
    const edits = [
      edit("add_node", { id: "Legal review", label: "Legal review" }),
      edit(
        "add_edge",
        { source: "Request received", target: "Legal review" },
        1
      ),
    ];
    const added = editableGraph(events, "vendor", edits);
    expect(
      added.model.nodes.find((node) => node.id === "Legal review")
    ).toMatchObject({ count: 0, plane: "designed" });
    expect(
      added.model.edges.find(
        (edge) =>
          edge.source === "Request received" && edge.target === "Legal review"
      )
    ).toMatchObject({ plane: "designed" });

    const removed = editableGraph(events, "vendor", [
      ...edits,
      edit(
        "remove_edge",
        { source: "Request received", target: "Legal review" },
        2
      ),
      edit("remove_node", { id: "Legal review" }, 3),
    ]);
    expect(removed.model.nodes.some((node) => node.id === "Legal review")).toBe(
      false
    );
    expect(
      removed.model.edges.some(
        (edge) =>
          edge.source === "Request received" && edge.target === "Legal review"
      )
    ).toBe(false);
  });

  it("rewires evidence through a merge and hides the merged node", () => {
    const before = editableGraph(events, "vendor", []);
    const sourceCount =
      before.model.nodes.find((node) => node.id === "Changes requested")
        ?.count ?? 0;
    const targetCount =
      before.model.nodes.find((node) => node.id === "Risk review")?.count ?? 0;
    const after = editableGraph(events, "vendor", [
      edit("merge", {
        source: "Changes requested",
        target: "Risk review",
      }),
    ]);

    expect(
      after.model.nodes.some((node) => node.id === "Changes requested")
    ).toBe(false);
    expect(
      after.model.nodes.find((node) => node.id === "Risk review")?.count
    ).toBe(sourceCount + targetCount);
    expect(
      after.model.edges.some(
        (edge) =>
          edge.source === "Changes requested" ||
          edge.target === "Changes requested"
      )
    ).toBe(false);
  });

  it("merges a designed source into a discovered target", () => {
    const after = editableGraph(events, "vendor", [
      edit("merge", {
        source: "Risk review",
        target: "Changes requested",
      }),
    ]);

    expect(
      after.designed.activities.find((item) => item.slug === "Risk review")
    ).toBeUndefined();
    expect(
      after.designed.activities.find(
        (item) => item.slug === "Changes requested"
      )?.synonyms
    ).toContain("Risk review");
    expect(
      after.model.nodes.find((node) => node.id === "Changes requested")
    ).toMatchObject({ plane: "both" });
  });

  it("supports rename, retire, reject, require and confirm edits", () => {
    const renamed = editableGraph(events, "vendor", [
      edit("rename", { id: "Risk review", label: "Compliance review" }),
    ]);
    expect(
      renamed.model.nodes.find((node) => node.id === "Risk review")
    ).toMatchObject({ label: "Compliance review" });
    expect(
      renamed.designed.activities.find((item) => item.slug === "Risk review")
        ?.synonyms
    ).toContain("Risk review");

    const retired = editableGraph(events, "vendor", [
      edit("retire", { id: "Risk review" }),
    ]);
    expect(
      retired.model.nodes.find((node) => node.id === "Risk review")
    ).toMatchObject({ plane: "discovered" });

    const rejected = editableGraph(events, "vendor", [
      edit("reject", { id: "Approved" }),
    ]);
    expect(rejected.model.nodes.some((node) => node.id === "Approved")).toBe(
      false
    );

    const required = editableGraph(events, "vendor", [
      edit("require", { source: "Request received", target: "Approved" }),
      edit("confirm", { id: "Contract signed" }, 1),
    ]);
    expect(
      required.model.edges.find(
        (edge) =>
          edge.source === "Request received" && edge.target === "Approved"
      )
    ).toMatchObject({ plane: "both" });
  });

  it("validates legal edit payloads before persistence", () => {
    expect(
      prepareGraphEdit({
        action: "rename",
        edits: [],
        events,
        payload: { id: "Risk review", label: "Compliance review" },
        workflow: "vendor",
      })
    ).toEqual({
      action: "rename",
      payload: { id: "Risk review", label: "Compliance review" },
    });
    expect(
      prepareGraphEdit({
        action: "merge",
        edits: [],
        events,
        payload: { source: "Changes requested", target: "Risk review" },
        workflow: "vendor",
      }).payload
    ).toEqual({ source: "Changes requested", target: "Risk review" });
    expect(
      prepareGraphEdit({
        action: "require",
        edits: [],
        events,
        payload: { source: "Request received", target: "Approved" },
        workflow: "vendor",
      }).action
    ).toBe("require");
    expect(
      prepareGraphEdit({
        action: "add_node",
        edits: [],
        events,
        payload: { label: "Legal review", role: 7 },
        workflow: "vendor",
      }).payload
    ).toEqual({ id: "Legal review", label: "Legal review" });
    expect(
      prepareGraphEdit({
        action: "retire",
        edits: [],
        events,
        payload: { id: "Risk review" },
        workflow: "vendor",
      }).action
    ).toBe("retire");
    expect(
      prepareGraphEdit({
        action: "reject",
        edits: [],
        events,
        payload: { id: "Approved" },
        workflow: "vendor",
      }).action
    ).toBe("reject");
  });

  it("surfaces role deviations introduced by designed edits", () => {
    const after = editableGraph(events, "vendor", [
      edit("promote", { id: "Changes requested", role: "Finance" }),
    ]);

    expect(after.conformance.roleDeviations).toContainEqual({
      expected: "Finance",
      observed: ["Compliance"],
      slug: "Changes requested",
    });
  });

  it("drops undone edits and reapplies redone edits by flag state", () => {
    const active = edit("promote", { id: "Changes requested" });
    const undone = editableGraph(events, "vendor", [
      { ...active, undone: true },
    ]);
    const redone = editableGraph(events, "vendor", [active]);

    expect(undone.revision).toBe("0:base");
    expect(
      undone.model.nodes.find((node) => node.id === "Changes requested")
    ).toMatchObject({ plane: "discovered" });
    expect(
      redone.model.nodes.find((node) => node.id === "Changes requested")
    ).toMatchObject({ plane: "both" });
  });

  it("rejects illegal edits before persistence", () => {
    expect(() =>
      prepareGraphEdit({
        action: "promote",
        edits: [],
        events,
        payload: { id: "Risk review" },
        workflow: "vendor",
      })
    ).toThrow("Only discovered nodes can be promoted.");
    expect(() =>
      prepareGraphEdit({
        action: "remove_edge",
        edits: [],
        events,
        payload: { source: "Contract signed", target: "Request received" },
        workflow: "vendor",
      })
    ).toThrow("That edge is not present in the graph.");
    expect(() =>
      prepareGraphEdit({
        action: "add_node",
        edits: [],
        events,
        payload: { label: "Risk review" },
        workflow: "vendor",
      })
    ).toThrow("A node with that label already exists.");
    expect(() =>
      prepareGraphEdit({
        action: "add_node",
        edits: [],
        events,
        payload: { label: "Bad::Node" },
        workflow: "vendor",
      })
    ).toThrow("Node labels must be 1 to 60 characters");
    expect(() =>
      prepareGraphEdit({
        action: "unknown",
        edits: [],
        events,
        payload: {},
        workflow: "vendor",
      })
    ).toThrow("Unknown graph edit action.");
    expect(() =>
      prepareGraphEdit({
        action: "add_node",
        edits: [],
        events,
        payload: null,
        workflow: "vendor",
      })
    ).toThrow("Edit payload must be an object.");
  });
});
