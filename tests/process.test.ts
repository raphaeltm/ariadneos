import { describe, expect, it } from "vitest";
import { duration, isWorkflow, median, mine } from "../shared/process.ts";
import { simulate } from "../shared/simulation.ts";

describe("process discovery", () => {
  it("reconstructs known traces and exposes exact transition evidence", () => {
    const events = simulate("vendor", 42, 24);
    const model = mine(events);
    expect(model.stats.cases).toBe(24);
    expect(model.stats.events).toBe(events.length);
    expect(model.variants.reduce((sum, v) => sum + v.count, 0)).toBe(24);
    for (const edge of model.edges) {
      expect(edge.count).toBe(edge.evidence.length);
      for (const ev of edge.evidence) {
        expect(events.find((e) => e.id === ev.from)?.action).toBe(edge.source);
        expect(events.find((e) => e.id === ev.to)?.action).toBe(edge.target);
      }
    }
    for (const node of model.nodes.filter((n) => !n.terminal)) {
      expect(
        model.edges
          .filter((e) => e.source === node.id)
          .reduce((sum, e) => sum + e.probability, 0)
      ).toBeCloseTo(1);
    }
  });
  it("is invariant to duplicate and out-of-order delivery", () => {
    const events = simulate("refund", 23, 20);
    const shuffled = [...events].reverse().concat(events.slice(0, 10));
    const canonical = (items: typeof events) => {
      const model = mine(items);
      return {
        edges: model.edges
          .map((e) => ({
            count: e.count,
            id: e.id,
            probability: e.probability,
          }))
          .sort((a, b) => a.id.localeCompare(b.id)),
        stats: model.stats,
      };
    };
    expect(canonical(shuffled)).toEqual(canonical(events));
  });
  it("counts a known rework loop and handoffs without inventing edges", () => {
    const base = simulate("vendor", 1, 1).slice(0, 4);
    const events = base.map((e, i) => ({
      ...e,
      action: ["A", "B", "A", "C"][i] ?? "missing",
      actor: ["Maya", "Oliver", "Maya", "Maya"][i] ?? "missing",
    }));
    const model = mine(events);
    expect(model.edges.map((e) => e.id)).toEqual(["A::B", "B::A", "A::C"]);
    expect(model.edges[0]?.probability).toBe(0.5);
    expect(model.stats.handoffs).toBe(2);
    expect(model.nodes.find((n) => n.id === "A")?.count).toBe(2);
  });
  it("handles an empty event log and even medians", () => {
    expect(mine([]).stats.cases).toBe(0);
    expect(median([4, 1, 3, 2])).toBe(2.5);
  });
});

describe("edge cases and reproducibility", () => {
  it("preserves deterministic simulations for every workflow", () => {
    for (const workflow of ["vendor", "refund", "access"] as const) {
      const first = simulate(workflow, 42, 24);
      expect(simulate(workflow, 42, 24)).toEqual(first);
      expect(mine(first).stats.cases).toBe(24);
      expect(new Set(first.map((event) => event.id)).size).toBe(first.length);
    }
  });
  it("handles a single observation without inventing a transition", () => {
    const events = simulate("access", 42, 1).slice(0, 1);
    const model = mine(events);
    expect(model.edges).toEqual([]);
    expect(model.stats.medianMinutes).toBe(0);
    expect(model.nodes[0]?.terminal).toBe(true);
  });
  it("computes odd and empty medians without mutating inputs", () => {
    const values = [3, 1, 2];
    expect(median(values)).toBe(2);
    expect(values).toEqual([3, 1, 2]);
    expect(median([])).toBe(0);
  });
});

describe("display and observation boundaries", () => {
  it("formats durations and validates workflow IDs", () => {
    expect(duration(30)).toBe("30m");
    expect(duration(90)).toBe("1.5h");
    expect(isWorkflow("vendor")).toBe(true);
    expect(isWorkflow("unknown")).toBe(false);
  });
  it("keeps independently seeded runs separate", () => {
    const baseline = simulate("vendor", 42, 1);
    const additional = simulate("vendor", 42, 1, "another-run");
    expect(mine([...baseline, ...additional]).stats.cases).toBe(2);
    expect(additional[0]?.caseId).toContain("anothe-");
  });
  it("uses source sequence to order equal timestamps", () => {
    const events = simulate("access", 42, 1).map((event) => ({
      ...event,
      timestamp: "2026-09-01T00:00:00.000Z",
    }));
    const model = mine([...events].reverse());
    expect(model.traces[0]?.events.map((event) => event.sequence)).toEqual(
      events.map((event) => event.sequence)
    );
    expect(model.stats.medianMinutes).toBe(0);
  });
});
