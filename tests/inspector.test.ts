import { describe, expect, it } from "vitest";
import { buildContractInspectorDetails } from "../src/components/inspector/inspector-data.ts";
import { applySnapshot, createInitialState } from "../src/store.ts";
import { observedClientFixtures, TEST_WORKFLOW } from "./helpers/tenant.ts";

const SLACK_PERMALINK = /^https:\/\/[^/]+\/archives\//;

function loadedState() {
  const fixtures = observedClientFixtures();
  const state = applySnapshot(
    createInitialState(fixtures.scope),
    fixtures.finalSnapshot as never,
    fixtures.scope
  );
  return { fixtures, state };
}

describe("process inspector data", () => {
  it("resolves a selected designed activity nobody performed", () => {
    const { fixtures, state } = loadedState();
    const details = buildContractInspectorDetails({
      conformance: Object.values(state.conformance),
      graph: fixtures.finalSnapshot.graph,
      kb: state.kb,
      messages: state.messages,
      selection: {
        node_id: "act_security_review",
        workflow_id: TEST_WORKFLOW,
      },
      sessions: state.sessions,
      steps: state.steps,
    });

    expect(details.title).toBe("Security review");
    expect(details.type).toBe("node");
    // Nothing was observed for it, so there is no evidence to show and the
    // inspector must say so rather than borrowing another activity's evidence.
    expect(details.evidence).toEqual([]);
    expect(
      details.conformanceSections.some(
        (section) => section.title === "Missing work"
      )
    ).toBe(true);
  });

  it("resolves an observed activity to its Slack evidence", () => {
    const { fixtures, state } = loadedState();
    const details = buildContractInspectorDetails({
      conformance: Object.values(state.conformance),
      graph: fixtures.finalSnapshot.graph,
      kb: state.kb,
      messages: state.messages,
      selection: {
        node_id: "act_deploy_fix",
        workflow_id: TEST_WORKFLOW,
      },
      sessions: state.sessions,
      steps: state.steps,
    });

    expect(details.title).toBe("Deploy fix");
    expect(details.evidence.length).toBeGreaterThan(0);
    for (const entry of details.evidence) {
      // Every evidence entry must point at a real Slack message.
      expect(entry.permalink).toMatch(SLACK_PERMALINK);
      expect(entry.quote).not.toBe("");
    }
  });

  it("resolves a selected transition to the steps that produced it", () => {
    const { fixtures, state } = loadedState();
    const [edge] = fixtures.finalSnapshot.graph.edges.filter(
      (candidate) => candidate.observed_support > 0
    );
    if (!edge) {
      throw new Error("Expected an observed transition in the graph.");
    }
    const details = buildContractInspectorDetails({
      conformance: Object.values(state.conformance),
      graph: fixtures.finalSnapshot.graph,
      kb: state.kb,
      messages: state.messages,
      selection: { edge_id: edge.id, workflow_id: TEST_WORKFLOW },
      sessions: state.sessions,
      steps: state.steps,
    });

    expect(details.type).toBe("edge");
    expect(details.evidence.length).toBeGreaterThan(0);
  });

  it("returns an empty detail for a selection that no longer exists", () => {
    const { fixtures, state } = loadedState();
    const details = buildContractInspectorDetails({
      conformance: Object.values(state.conformance),
      graph: fixtures.finalSnapshot.graph,
      kb: state.kb,
      messages: state.messages,
      selection: {
        node_id: "act_does_not_exist",
        workflow_id: TEST_WORKFLOW,
      },
      sessions: state.sessions,
      steps: state.steps,
    });

    expect(details.evidence).toEqual([]);
    expect(details.curationItems).toEqual([]);
  });
});
