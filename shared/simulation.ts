import { type ActivityEvent, type WorkflowId, workflows } from "./process.ts";

const steps: Record<string, [string, string]> = {
  "Access granted": ["Noah Patel", "IT"],
  "Access requested": ["Maya Chen", "Operations"],
  Approved: ["Sofia Reyes", "Team lead"],
  "Changes requested": ["Oliver Park", "Compliance"],
  "Contract signed": ["James Wilson", "Finance"],
  "Customer notified": ["Ava Thompson", "Support"],
  "Details updated": ["Maya Chen", "Operations"],
  "Eligibility checked": ["Leo Martin", "Support"],
  Escalated: ["Sofia Reyes", "Team lead"],
  "Manager review": ["Sofia Reyes", "Team lead"],
  "Refund issued": ["James Wilson", "Finance"],
  "Refund requested": ["Ava Thompson", "Support"],
  "Request closed": ["Noah Patel", "IT"],
  "Request received": ["Maya Chen", "Operations"],
  "Risk review": ["Oliver Park", "Compliance"],
  "Security review": ["Oliver Park", "Compliance"],
};
export const paths: Record<WorkflowId, string[][]> = {
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
};
const artifacts: Record<WorkflowId, string[]> = {
  access: [
    "Analytics workspace",
    "Production dashboard",
    "Design workspace",
    "Customer CRM",
    "Engineering repository",
  ],
  refund: [
    "Annual plan refund",
    "Duplicate payment",
    "Subscription refund",
    "Trial conversion refund",
  ],
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
};
export function simulate(
  workflow: WorkflowId,
  seed = 42,
  count = 24,
  prefix = "baseline",
  start = Date.UTC(2026, 8, 1)
): ActivityEvent[] {
  // biome-ignore lint/suspicious/noBitwiseOperators: LCG requires unsigned 32-bit wrapping.
  let state = seed >>> 0;
  const random = () => {
    // biome-ignore lint/suspicious/noBitwiseOperators: Preserve deterministic LCG overflow.
    state = (Math.imul(state, 1_664_525) + 1_013_904_223) >>> 0;
    return state / 4_294_967_296;
  };
  const definition = workflows.find((w) => w.id === workflow);
  if (!definition) {
    throw new Error(`Unknown workflow: ${workflow}`);
  }
  return Array.from({ length: count }, (_, i) => {
    const chance = random();
    let variant = 2;
    if (chance < 0.7) {
      variant = 0;
    } else if (chance < 0.92) {
      variant = 1;
    }
    const caseId = `${definition.prefix}-${prefix === "baseline" ? "" : `${prefix.slice(0, 6)}-`}${String(i + 101).padStart(3, "0")}`;
    let time = start + i * 14_400_000;
    const path = paths[workflow][variant];
    if (!path) {
      throw new Error("Missing simulation path");
    }
    const artifact = artifacts[workflow][i % artifacts[workflow].length];
    if (!artifact) {
      throw new Error("Missing simulation artifact");
    }
    return path.map((action, sequence) => {
      if (sequence) {
        time +=
          Math.round(15 + random() * (action === "Approved" ? 240 : 100)) *
          60_000;
      }
      const step = steps[action];
      if (!step) {
        throw new Error(`Missing simulation actor: ${action}`);
      }
      const [actor, role] = step;
      return {
        action,
        actor,
        artifact,
        caseId,
        id: `${prefix}:${workflow}:${i}:${sequence}`,
        role,
        sequence,
        source: "simulation" as const,
        timestamp: new Date(time).toISOString(),
        workflow,
      };
    });
  }).flat();
}
