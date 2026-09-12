import { describe, expect, it } from "vitest";
import type { ProcessModel } from "../shared/process.ts";
import {
  applyCurationEdits,
  createCurationDraft,
  curationSummary,
  legalCurationActions,
  persistCurationDraft,
  persistCurationUndo,
  undoLastCurationDraft,
} from "../src/curation.ts";

describe("graph curation projection", () => {
  it("derives legal inline actions for selected nodes and edges", () => {
    expect(legalCurationActions("node", "review", model())).toEqual([
      "confirm",
      "reject",
      "merge",
      "split",
    ]);
    expect(legalCurationActions("edge", "review::approve", model())).toEqual([
      "confirm",
      "reject",
      "split",
    ]);
    expect(legalCurationActions("node", "missing", model())).toEqual([]);
  });

  it("rejects optimistically and restores the graph when undone", () => {
    const draft = createCurationDraft({
      action: "reject",
      id: "cur_reject",
      model: model(),
      targetId: "review",
      targetKind: "node",
    });
    const rejected = applyCurationEdits(model(), [
      { ...draft, persistence: "saved" },
    ]);
    expect(rejected.model.nodes.map((node) => node.id)).toEqual([
      "intake",
      "approve",
    ]);
    expect(
      rejected.model.edges.some(
        (edge) => edge.source === "review" || edge.target === "review"
      )
    ).toBe(false);
    const undone = applyCurationEdits(
      model(),
      undoLastCurationDraft([{ ...draft, persistence: "saved" }])
    );
    expect(undone.model.nodes.map((node) => node.id)).toContain("review");
  });

  it("merges into the strongest neighbor and preserves undo state", () => {
    const draft = createCurationDraft({
      action: "merge",
      id: "cur_merge",
      model: model(),
      targetId: "review",
      targetKind: "node",
    });
    const merged = applyCurationEdits(model(), [
      { ...draft, persistence: "local" },
    ]);
    expect(draft.mergeTargetId).toBe("approve");
    expect(merged.model.nodes.map((node) => node.id)).toEqual([
      "intake",
      "approve",
    ]);
    expect(
      merged.model.nodes.find((node) => node.id === "approve")?.count
    ).toBe(9);
    expect(curationSummary([{ ...draft, persistence: "local" }])).toEqual({
      active: 1,
      failed: 0,
      local: 1,
      pending: 0,
      saved: 0,
    });
  });

  it("splits a transition into a curation handoff node", () => {
    const draft = createCurationDraft({
      action: "split",
      id: "cur_split",
      model: model(),
      targetId: "review::approve",
      targetKind: "edge",
    });
    const split = applyCurationEdits(model(), [
      { ...draft, persistence: "saved" },
    ]);
    expect(split.model.edges.map((edge) => edge.id).sort()).toEqual([
      "intake::review",
      "review::approve::split::cur_split::approve",
      "review::review::approve::split::cur_split",
    ]);
    expect(
      split.model.nodes.find((node) => node.id.includes("split"))?.label
    ).toBe("Curated handoff");
  });
});

describe("curation API integration", () => {
  it("posts bounded model-edit payloads and treats missing routes as local-only", async () => {
    const draft = createCurationDraft({
      action: "confirm",
      id: "cur_confirm",
      model: model(),
      targetId: "review",
      targetKind: "node",
    });
    const calls: unknown[] = [];
    const fetcher = (path: RequestInfo | URL, init?: RequestInit) => {
      calls.push({ body: init?.body, path });
      return Promise.resolve(
        new Response(JSON.stringify({ error: "Not found." }), {
          status: 404,
        })
      );
    };
    await expect(
      persistCurationDraft(draft, "vendor", fetcher as typeof fetch)
    ).resolves.toEqual({
      detail: "The model edit API is not available on this revision.",
      persisted: false,
    });
    await expect(
      persistCurationUndo("vendor", fetcher as typeof fetch)
    ).resolves.toEqual({
      detail: "The model edit undo API is not available on this revision.",
      persisted: false,
    });
    expect(calls).toEqual([
      {
        body: JSON.stringify({
          action: "confirm",
          payload: {
            merge_target_id: undefined,
            target_id: "review",
            target_kind: "node",
          },
          request_id: "cur_confirm",
          workflow: "vendor",
        }),
        path: "/api/model/edit",
      },
      {
        body: JSON.stringify({ workflow: "vendor" }),
        path: "/api/model/edit/undo",
      },
    ]);
  });
});

function model(): ProcessModel {
  return {
    edges: [
      {
        cases: 2,
        count: 2,
        evidence: [],
        id: "intake::review",
        medianMinutes: 3,
        probability: 1,
        source: "intake",
        target: "review",
      },
      {
        cases: 4,
        count: 4,
        evidence: [],
        id: "review::approve",
        medianMinutes: 5,
        probability: 1,
        source: "review",
        target: "approve",
      },
    ],
    nodes: [
      {
        actors: ["Priya"],
        count: 2,
        id: "intake",
        label: "Intake",
        role: "Support",
        terminal: false,
      },
      {
        actors: ["Tom"],
        count: 4,
        id: "review",
        label: "Review",
        role: "Engineering",
        terminal: false,
      },
      {
        actors: ["Dana"],
        count: 5,
        id: "approve",
        label: "Approve",
        role: "Leadership",
        terminal: true,
      },
    ],
    stats: {
      cases: 4,
      dominantShare: 1,
      events: 11,
      handoffs: 2,
      medianMinutes: 8,
      variants: 1,
    },
    traces: [],
    variants: [],
  };
}
