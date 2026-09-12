import { describe, expect, it } from "vitest";
import {
  clampDemoStepIndex,
  demoStepLabel,
  demoWalkthroughSteps,
  nextDemoStepIndex,
} from "../src/demo-walkthrough.ts";

describe("demo walkthrough model", () => {
  it("defines a deterministic six-beat presenter walkthrough", () => {
    expect(demoWalkthroughSteps.map((step) => step.id)).toEqual([
      "open",
      "simulate",
      "conversation",
      "graph",
      "evidence",
      "variants",
    ]);
    expect(demoWalkthroughSteps.map((step) => step.target)).toEqual([
      "overview",
      "run",
      "conversation",
      "graph",
      "inspector",
      "variants",
    ]);
  });

  it("clamps direct jumps and arrow navigation to valid beats", () => {
    expect(clampDemoStepIndex(-1)).toBe(0);
    expect(clampDemoStepIndex(100)).toBe(demoWalkthroughSteps.length - 1);
    expect(nextDemoStepIndex(0, -1)).toBe(0);
    expect(nextDemoStepIndex(0, 1)).toBe(1);
    expect(nextDemoStepIndex(demoWalkthroughSteps.length - 1, 1)).toBe(
      demoWalkthroughSteps.length - 1
    );
  });

  it("renders stable two-digit step labels for annotations", () => {
    expect(demoStepLabel(0)).toBe("01");
    expect(demoStepLabel(5)).toBe("06");
  });
});
