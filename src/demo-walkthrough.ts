export type DemoPlaybackState = "idle" | "paused" | "playing";

export type DemoTarget =
  | "assistant"
  | "conversation"
  | "graph"
  | "inspector"
  | "overview"
  | "run"
  | "variants";

export type DemoAction =
  | "ask"
  | "events"
  | "graph"
  | "run"
  | "select-edge"
  | "select-node"
  | "variants";

export interface DemoWalkthroughStep {
  action: DemoAction;
  detail: string;
  durationMs: number;
  id: string;
  label: string;
  target: DemoTarget;
  title: string;
}

export const demoWalkthroughSteps = [
  {
    action: "graph",
    detail:
      "Start from the documented process so the audience sees the baseline before new activity lands.",
    durationMs: 3200,
    id: "open",
    label: "Documented process",
    target: "overview",
    title: "Open on the process that people think they run",
  },
  {
    action: "run",
    detail:
      "Run the deterministic simulator once, then keep the model on screen while the app refreshes.",
    durationMs: 4200,
    id: "simulate",
    label: "Simulated workflow",
    target: "run",
    title: "Let the Slack-shaped workflow unfold",
  },
  {
    action: "events",
    detail:
      "The conversation rail shows who did what, which case it belongs to, and when it happened.",
    durationMs: 3600,
    id: "conversation",
    label: "Conversation evidence",
    target: "conversation",
    title: "Every step starts as an observed message",
  },
  {
    action: "select-node",
    detail:
      "Selecting a step opens the inspector and keeps the graph selection tied to its supporting activity.",
    durationMs: 3600,
    id: "graph",
    label: "Graph assembly",
    target: "graph",
    title: "The canvas turns activity into a process map",
  },
  {
    action: "select-edge",
    detail:
      "Edges carry source event IDs, so the walkthrough can jump from a transition to the raw event log.",
    durationMs: 3600,
    id: "evidence",
    label: "Evidence trail",
    target: "inspector",
    title: "Claims stay attached to evidence",
  },
  {
    action: "variants",
    detail:
      "Variants make the main path and branches visible before the presenter moves into conformance or repair.",
    durationMs: 3600,
    id: "variants",
    label: "Variant view",
    target: "variants",
    title: "The same workflow now has visible paths",
  },
] as const satisfies readonly DemoWalkthroughStep[];

export const [firstDemoWalkthroughStep] = demoWalkthroughSteps;

export function clampDemoStepIndex(
  index: number,
  total = demoWalkthroughSteps.length
) {
  if (total < 1) {
    return 0;
  }
  return Math.min(Math.max(index, 0), total - 1);
}

export function nextDemoStepIndex(
  current: number,
  direction: -1 | 1,
  total = demoWalkthroughSteps.length
) {
  return clampDemoStepIndex(current + direction, total);
}

export function demoStepLabel(index: number) {
  return String(index + 1).padStart(2, "0");
}
