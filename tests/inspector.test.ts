import { describe, expect, it } from "vitest";
import { mine } from "../shared/process.ts";
import { simulate } from "../shared/simulation.ts";
import { createClientFixtures } from "../src/api.ts";
import {
  buildContractInspectorDetails,
  buildLegacyInspectorDetails,
} from "../src/components/inspector/inspector-data.ts";
import { applySnapshot, createInitialState } from "../src/store.ts";

const ACCESS_CASE_ID = /^ACC-/;

describe("process inspector data", () => {
  it("resolves selected typed graph nodes to evidence and curation detail", () => {
    const fixtures = createClientFixtures();
    const state = applySnapshot(
      createInitialState(fixtures.scope),
      fixtures.finalSnapshot,
      fixtures.scope
    );
    const details = buildContractInspectorDetails({
      conformance: Object.values(state.conformance),
      graph: fixtures.finalSnapshot.graph,
      kb: state.kb,
      messages: state.messages,
      selection: {
        node_id: "act_security_review",
        workflow_id: "wf_p1_incident",
      },
      sessions: state.sessions,
      steps: state.steps,
    });

    expect(details.title).toBe("Security review");
    expect(details.metrics).toContainEqual({ label: "Grounded", value: "2/2" });
    expect(details.evidence.map((entry) => entry.quote)).toContain(
      "Skipping the security checklist to save time."
    );
    expect(details.curationItems.map((item) => item.id)).toContain(
      "stp_helios_skip_negated_security"
    );
    expect(
      details.conformanceSections.some(
        (section) => section.title === "Missing work"
      )
    ).toBe(true);
  });

  it("surfaces edge policy violations with source evidence", () => {
    const fixtures = createClientFixtures();
    const state = applySnapshot(
      createInitialState(fixtures.scope),
      fixtures.finalSnapshot,
      fixtures.scope
    );
    const details = buildContractInspectorDetails({
      conformance: Object.values(state.conformance),
      graph: fixtures.finalSnapshot.graph,
      kb: state.kb,
      messages: state.messages,
      selection: {
        edge_id: "ged_root_deploy_violation",
        workflow_id: "wf_p1_incident",
      },
      sessions: state.sessions,
      steps: state.steps,
    });

    expect(details.type).toBe("edge");
    expect(details.badges).toContain("1 policy issue");
    expect(details.evidence.length).toBeGreaterThan(0);
    expect(
      details.conformanceSections.find(
        (section) => section.title === "Policy violations"
      )?.items[0]
    ).toContain("security review");
  });

  it("keeps legacy app selections readable while typed snapshot app shell lands", () => {
    const events = simulate("access", 42, 6);
    const model = mine(events);
    const selectedNode = model.nodes.find(
      (node) => node.id === "Security review"
    );
    if (!selectedNode) {
      throw new Error("Missing simulated security review node.");
    }
    const details = buildLegacyInspectorDetails({
      events: events.filter((event) => event.action === selectedNode.id),
      model,
      selectedEdge: undefined,
      selectedNode,
      selection: { id: selectedNode.id, kind: "node" },
    });

    expect(details.title).toBe("Security review");
    expect(details.evidence[0]).toMatchObject({
      author: "Oliver Park",
      caseId: expect.stringMatching(ACCESS_CASE_ID),
    });
  });
});
