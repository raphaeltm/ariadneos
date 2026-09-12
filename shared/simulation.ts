import { workflows, type ActivityEvent, type WorkflowId } from "./process";
const steps: Record<string, [string, string]> = {
  "Request received": ["Maya Chen", "Operations"],
  "Risk review": ["Oliver Park", "Compliance"],
  "Changes requested": ["Oliver Park", "Compliance"],
  "Details updated": ["Maya Chen", "Operations"],
  Approved: ["Sofia Reyes", "Team lead"],
  "Contract signed": ["James Wilson", "Finance"],
  "Refund requested": ["Ava Thompson", "Support"],
  "Eligibility checked": ["Leo Martin", "Support"],
  Escalated: ["Sofia Reyes", "Team lead"],
  "Refund issued": ["James Wilson", "Finance"],
  "Customer notified": ["Ava Thompson", "Support"],
  "Access requested": ["Maya Chen", "Operations"],
  "Manager review": ["Sofia Reyes", "Team lead"],
  "Security review": ["Oliver Park", "Compliance"],
  "Access granted": ["Noah Patel", "IT"],
  "Request closed": ["Noah Patel", "IT"],
};
export const paths: Record<WorkflowId, string[][]> = {
  vendor: [
    ["Request received", "Risk review", "Approved", "Contract signed"],
    [
      "Request received",
      "Risk review",
      "Changes requested",
      "Details updated",
      "Risk review",
      "Approved",
      "Contract signed",
    ],
    ["Request received", "Approved", "Contract signed"],
  ],
  refund: [
    [
      "Refund requested",
      "Eligibility checked",
      "Refund issued",
      "Customer notified",
    ],
    [
      "Refund requested",
      "Eligibility checked",
      "Escalated",
      "Refund issued",
      "Customer notified",
    ],
    [
      "Refund requested",
      "Escalated",
      "Eligibility checked",
      "Refund issued",
      "Customer notified",
    ],
  ],
  access: [
    ["Access requested", "Manager review", "Access granted", "Request closed"],
    [
      "Access requested",
      "Manager review",
      "Security review",
      "Access granted",
      "Request closed",
    ],
    [
      "Access requested",
      "Security review",
      "Manager review",
      "Access granted",
      "Request closed",
    ],
  ],
};
const artifacts: Record<WorkflowId, string[]> = {
  vendor: [
    "Linear",
    "Figma",
    "Notion",
    "Miro",
    "Vercel",
    "Slack",
    "Dropbox",
    "Sentry",
  ],
  refund: [
    "Annual plan refund",
    "Duplicate payment",
    "Subscription refund",
    "Trial conversion refund",
  ],
  access: [
    "Analytics workspace",
    "Production dashboard",
    "Design workspace",
    "Customer CRM",
    "Engineering repository",
  ],
};
export function simulate(
  workflow: WorkflowId,
  seed = 42,
  count = 24,
  prefix = "baseline",
  start = Date.UTC(2026, 8, 1),
): ActivityEvent[] {
  let state = seed >>> 0;
  const random = () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 4294967296;
  };
  const definition = workflows.find((w) => w.id === workflow)!;
  return Array.from({ length: count }, (_, i) => {
    const chance = random();
    const variant = chance < 0.7 ? 0 : chance < 0.92 ? 1 : 2;
    const caseId = `${definition.prefix}-${prefix === "baseline" ? "" : prefix.slice(0, 6) + "-"}${String(i + 101).padStart(3, "0")}`;
    let time = start + i * 14400000;
    return paths[workflow][variant].map((action, sequence) => {
      if (sequence)
        time +=
          Math.round(15 + random() * (action === "Approved" ? 240 : 100)) *
          60000;
      const [actor, role] = steps[action];
      return {
        id: `${prefix}:${workflow}:${i}:${sequence}`,
        caseId,
        workflow,
        actor,
        role,
        action,
        artifact: artifacts[workflow][i % artifacts[workflow].length],
        timestamp: new Date(time).toISOString(),
        source: "simulation" as const,
        sequence,
      };
    });
  }).flat();
}
