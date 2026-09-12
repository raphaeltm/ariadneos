import { describe, expect, it } from "vitest";
import {
  accessDesignedModel,
  emptyDesignedAccessGraph,
  type Spec08CompatibilityFixtureSet,
  spec08ActivityEvents,
  spec08AgentEvents,
  spec08Bridge,
  spec08CompatibilityFixtures,
  spec08GroundingCoverage,
  validateSpec08CompatibilityFixtures,
} from "../fixtures/contracts/spec08-compatibility.ts";
import {
  activityGrounding,
  activityWorkspace,
  DEFAULT_WORKSPACE,
  designedEdgesFrom,
  isAggregateEligible,
  mine,
} from "../shared/process.ts";
import { simulate } from "../shared/simulation.ts";

const copyFixtures = () =>
  structuredClone(spec08CompatibilityFixtures) as Spec08CompatibilityFixtureSet;

const errorsFor = (fixtureSet: Spec08CompatibilityFixtureSet) =>
  validateSpec08CompatibilityFixtures(fixtureSet).errors.join("\n");

describe("Spec 08 compatibility fixtures", () => {
  it("accepts the bundled compatibility fixture set", () => {
    expect(validateSpec08CompatibilityFixtures()).toEqual({
      errors: [],
      ok: true,
    });
  });

  it("covers grounding, curation, lifecycle and modality states", () => {
    expect(spec08GroundingCoverage()).toEqual(
      new Set(["confirmed", "grounded", "inferred", "proposed", "rejected"])
    );
    expect(new Set(spec08ActivityEvents.map((event) => event.status))).toEqual(
      new Set([undefined, "confirmed", "proposed", "rejected"])
    );
    expect(new Set(spec08ActivityEvents.map((event) => event.state))).toEqual(
      new Set(["abandoned", "committed", "done", "requested", "skipped"])
    );
    expect(
      new Set(spec08ActivityEvents.map((event) => event.modality))
    ).toEqual(new Set(["committed", "negated", "reported", "requested"]));
  });

  it("keeps empty designed access graph edges separate from discovered edges", () => {
    expect(emptyDesignedAccessGraph.events).toEqual([]);
    expect(emptyDesignedAccessGraph.model.edges).toEqual([]);
    expect(emptyDesignedAccessGraph.model.stats.events).toBe(0);
    expect(emptyDesignedAccessGraph.model.designedEdges).toHaveLength(4);
    for (const edge of emptyDesignedAccessGraph.model.designedEdges ?? []) {
      expect(edge.count).toBe(0);
      expect(edge.evidence).toEqual([]);
      expect(edge.plane).toBe("designed");
    }
  });

  it("exposes a contracts.ts bridge for downstream consumers", () => {
    expect(spec08Bridge.designed).toBe(accessDesignedModel);
    expect(spec08Bridge.designedEdges).toHaveLength(4);
    expect(spec08Bridge.messages?.every((ref) => ref.workspace)).toBe(true);
  });

  it("keeps discovered edge invariants when a designed model is supplied", () => {
    const events = simulate("access", 42, 24);
    const model = mine(events, accessDesignedModel);

    expect(model.designedEdges?.map((edge) => edge.id)).toEqual([
      "Access requested::Manager review",
      "Manager review::Security review",
      "Security review::Access granted",
      "Access granted::Request closed",
    ]);
    expect(model.edges.some((edge) => edge.plane === "designed")).toBe(false);
    for (const edge of model.edges) {
      expect(edge.count).toBe(edge.evidence.length);
    }
    for (const node of model.nodes.filter((item) => !item.terminal)) {
      const outgoing = model.edges
        .filter((edge) => edge.source === node.id)
        .reduce((sum, edge) => sum + edge.probability, 0);
      expect(outgoing).toBeCloseTo(1);
    }
  });

  it("documents default workspace and confidence adapters for legacy events", () => {
    const [legacyEvent] = simulate("vendor", 42, 1);
    if (!legacyEvent) {
      throw new Error("Missing legacy fixture event");
    }
    expect(activityWorkspace(legacyEvent)).toBe(DEFAULT_WORKSPACE);
    expect(activityGrounding(legacyEvent)).toBe("inferred");
    expect(isAggregateEligible(legacyEvent)).toBe(true);
    expect(
      isAggregateEligible({
        ...legacyEvent,
        confidence: 0.2,
      })
    ).toBe(false);
    expect(
      isAggregateEligible({
        ...legacyEvent,
        status: "rejected",
      })
    ).toBe(false);
  });

  it("ignores malformed designed matrix entries when deriving bridge edges", () => {
    expect(
      designedEdgesFrom({
        ...accessDesignedModel,
        activities: accessDesignedModel.activities.slice(0, 1),
        matrix: [
          [0, 1],
          [1, 0],
        ],
      })
    ).toEqual([]);
  });

  it("covers the Security review skip and all AgentEvent decision values", () => {
    expect(
      spec08ActivityEvents.some(
        (event) =>
          event.action === "Security review" &&
          event.modality === "negated" &&
          event.state === "skipped"
      )
    ).toBe(true);
    expect(
      new Set(
        spec08AgentEvents.flatMap((event) =>
          event.resolution ? [event.resolution] : []
        )
      )
    ).toEqual(new Set(["approve", "hold", "reject"]));
  });

  it("rejects malformed message references", () => {
    const fixtureSet = copyFixtures();
    const [firstEvent] = fixtureSet.events;
    const [firstRef] = firstEvent?.messages ?? [];
    if (!(firstEvent && firstRef)) {
      throw new Error("Missing fixture message reference");
    }
    firstEvent.messages = [
      {
        ...firstRef,
        channel: "",
        permalink: "http://synthetic.invalid/insecure",
        workspace: "other-workspace",
      },
    ];
    const errors = errorsFor(fixtureSet);
    expect(errors).toContain("has an incomplete message reference");
    expect(errors).toContain("has an invalid message permalink");
    expect(errors).toContain("outside scope");
  });

  it("rejects inconsistent scoped records", () => {
    const fixtureSet = copyFixtures();
    const [pipelineEvent] = fixtureSet.pipelineEvents;
    const [link] = fixtureSet.links;
    if (!(pipelineEvent && link)) {
      throw new Error("Missing pipeline or link fixture");
    }
    pipelineEvent.caseId = "ACC-unknown";
    link.count += 1;
    const errors = errorsFor(fixtureSet);
    expect(errors).toContain("references unknown case");
    expect(errors).toContain(
      "workflow link Engineering repository count mismatch"
    );
  });
});
