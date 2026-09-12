import { describe, it, expect } from "vitest";
import { mine, median } from "../shared/process";
import { simulate } from "../shared/simulation";
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
    for (const node of model.nodes.filter((n) => !n.terminal))
      expect(
        model.edges
          .filter((e) => e.source === node.id)
          .reduce((sum, e) => sum + e.probability, 0),
      ).toBeCloseTo(1);
  });
  it("is invariant to duplicate and out-of-order delivery", () => {
    const events = simulate("refund", 23, 20);
    const shuffled = [...events].reverse().concat(events.slice(0, 10));
    const canonical = (items: typeof events) => {
      const model = mine(items);
      return {
        stats: model.stats,
        edges: model.edges
          .map((e) => ({
            id: e.id,
            count: e.count,
            probability: e.probability,
          }))
          .sort((a, b) => a.id.localeCompare(b.id)),
      };
    };
    expect(canonical(shuffled)).toEqual(canonical(events));
  });
  it("counts a known rework loop and handoffs without inventing edges", () => {
    const base = simulate("vendor", 1, 1).slice(0, 4);
    const events = base.map((e, i) => ({
      ...e,
      action: ["A", "B", "A", "C"][i],
      actor: ["Maya", "Oliver", "Maya", "Maya"][i],
    }));
    const model = mine(events);
    expect(model.edges.map((e) => e.id)).toEqual(["A::B", "B::A", "A::C"]);
    expect(model.edges[0].probability).toBe(0.5);
    expect(model.stats.handoffs).toBe(2);
    expect(model.nodes.find((n) => n.id === "A")?.count).toBe(2);
  });
  it("handles an empty event log and even medians", () => {
    expect(mine([]).stats.cases).toBe(0);
    expect(median([4, 1, 3, 2])).toBe(2.5);
  });
});
