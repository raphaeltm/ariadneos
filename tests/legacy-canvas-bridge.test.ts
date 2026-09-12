import { describe, expect, it } from "vitest";
import {
  type ActivityEvent,
  type DesignedModel,
  mine,
} from "../shared/process.ts";
import {
  canvasSelectionFromLegacy,
  legacyProcessToGraphView,
  legacySelectionFromCanvas,
} from "../src/legacy-canvas-bridge.ts";

const designed: DesignedModel = {
  activities: [
    { label: "Request vendor", role: "Procurement", slug: "request_vendor" },
    { label: "Approve vendor", role: "Finance", slug: "approve_vendor" },
    { label: "Security review", role: "Compliance", slug: "security_review" },
  ],
  entry: "request_vendor",
  matrix: [
    [0, 1, 0],
    [0, 0, 1],
    [0, 0, 0],
  ],
  policies: [],
  workflow: "vendor",
};

describe("legacy canvas bridge", () => {
  it("adapts legacy process data into the issue 24 workflow canvas graph", () => {
    const model = mine(
      [event("request_vendor", 1), event("approve_vendor", 2)],
      designed
    );
    const graph = legacyProcessToGraphView(
      model,
      "vendor",
      "2026-09-12T14:00:00.000Z"
    );

    expect(graph.kind).toBe("overlay");
    expect(graph.nodes.map((node) => node.id)).toContain("act_security_review");
    expect(
      graph.nodes.find((node) => node.id === "act_security_review")?.activity
        .plane
    ).toBe("designed");
    expect(
      graph.edges.find(
        (edge) => edge.id === "ged_request_vendor::approve_vendor"
      )?.plane
    ).toBe("both");
    expect(
      graph.edges.find(
        (edge) => edge.id === "ged_approve_vendor::security_review"
      )?.plane
    ).toBe("designed");
  });

  it("round-trips canvas and legacy inspector selections", () => {
    expect(
      canvasSelectionFromLegacy({ id: "request_vendor", kind: "node" })
    ).toEqual({
      node_id: "act_request_vendor",
    });
    expect(
      canvasSelectionFromLegacy({
        id: "request_vendor::approve_vendor",
        kind: "edge",
      })
    ).toEqual({
      edge_id: "ged_request_vendor::approve_vendor",
    });
    expect(
      legacySelectionFromCanvas({ node_id: "act_request_vendor" })
    ).toEqual({ id: "request_vendor", kind: "node" });
    expect(
      legacySelectionFromCanvas({
        edge_id: "ged_request_vendor::approve_vendor",
      })
    ).toEqual({ id: "request_vendor::approve_vendor", kind: "edge" });
  });
});

function event(action: string, sequence: number): ActivityEvent {
  return {
    action,
    actor: "Maya Chen",
    artifact: "Vendor ACME",
    caseId: "VEN-1",
    id: `evt_${sequence}`,
    role: sequence === 1 ? "Procurement" : "Finance",
    sequence,
    source: "simulation",
    timestamp: `2026-09-12T14:0${sequence}:00.000Z`,
    workflow: "vendor",
  };
}
