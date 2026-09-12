import type { ModelAdapter } from "../models.ts";
import {
  type ActivityId,
  type ExtractedStep,
  type ExtractionActivity,
  type MiningResult,
  type PromiseReportReconciliation,
  slugPattern,
} from "./types.ts";

interface RawCanonicalMatch {
  activity_id?: unknown;
  description?: unknown;
  label?: unknown;
  slug?: unknown;
  step_id?: unknown;
}

export interface CanonicalizedStep extends ExtractedStep {
  activity_id: ActivityId;
}

export interface CanonicalizationResult
  extends MiningResult<CanonicalizedStep> {
  activities: ExtractionActivity[];
  reconciliation: PromiseReportReconciliation[];
}

const canonicalizationSchema = {
  additionalProperties: false,
  properties: {
    matches: {
      items: {
        additionalProperties: false,
        properties: {
          activity_id: { anyOf: [{ type: "string" }, { type: "null" }] },
          description: { type: "string" },
          label: { type: "string" },
          slug: { anyOf: [{ type: "string" }, { type: "null" }] },
          step_id: { type: "string" },
        },
        required: ["step_id", "activity_id", "slug", "label", "description"],
        type: "object",
      },
      type: "array",
    },
  },
  required: ["matches"],
  type: "object",
};

function object(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function levenshtein(a: string, b: string) {
  const previous = Array.from({ length: b.length + 1 }, (_, index) => index);
  for (let i = 1; i <= a.length; i += 1) {
    const current = [i];
    for (let j = 1; j <= b.length; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      current[j] = Math.min(
        (current[j - 1] ?? 0) + 1,
        (previous[j] ?? 0) + 1,
        (previous[j - 1] ?? 0) + cost
      );
    }
    previous.splice(0, previous.length, ...current);
  }
  return previous[b.length] ?? 0;
}

function designedFirst(activities: readonly ExtractionActivity[]) {
  return [...activities].sort((a, b) => {
    const aDesigned = a.plane === "designed" || a.plane === "both" ? 0 : 1;
    const bDesigned = b.plane === "designed" || b.plane === "both" ? 0 : 1;
    return aDesigned - bDesigned || a.slug.localeCompare(b.slug);
  });
}

function bestDeterministicMatch(
  slug: string,
  activities: readonly ExtractionActivity[]
) {
  const exact = designedFirst(activities).find(
    (activity) => activity.slug === slug
  );
  if (exact) {
    return exact;
  }
  return designedFirst(activities).find(
    (activity) => levenshtein(slug, activity.slug) <= 2
  );
}

function toActivityId(slug: string): ActivityId {
  return `act_${slug}`;
}

function confidenceFor(step: ExtractedStep, matched: ExtractionActivity) {
  const adjusted =
    matched.plane === "designed" || matched.plane === "both"
      ? Math.min(step.confidence * 1.1, 1)
      : step.confidence;
  return {
    confidence: adjusted,
    status: adjusted >= 0.4 ? "confirmed" : "proposed",
  } as const;
}

function attachActivity(
  step: ExtractedStep,
  activity: ExtractionActivity
): CanonicalizedStep {
  const adjusted = confidenceFor(step, activity);
  return {
    ...step,
    activity_id: activity.id,
    confidence: adjusted.confidence,
    status: adjusted.status,
  };
}

function parseCanonicalPayload(payload: unknown) {
  if (!(object(payload) && Array.isArray(payload.matches))) {
    throw new Error("Canonicalization payload must contain matches.");
  }
  return payload.matches.filter(object) as RawCanonicalMatch[];
}

function canonicalPrompt(
  steps: readonly ExtractedStep[],
  activities: readonly ExtractionActivity[]
) {
  return JSON.stringify({
    activities: designedFirst(activities).map((activity) => ({
      id: activity.id,
      label: activity.label,
      plane: activity.plane ?? "discovered",
      slug: activity.slug,
    })),
    instructions: [
      "Prefer designed activities when their meaning matches.",
      "Use discovered activities only when no designed activity matches.",
      "Return null activity_id and a valid new verb_object slug only for genuinely new activities.",
    ],
    steps: steps.map((step) => ({
      activity_slug: step.activity_slug,
      intent: step.intent,
      label: step.label,
      step_id: step.id,
    })),
  });
}

async function adjudicateUnmatched(
  unmatched: readonly ExtractedStep[],
  activities: readonly ExtractionActivity[],
  model?: ModelAdapter
) {
  if (!(model && unmatched.length)) {
    return [];
  }
  const payload = await model.generateJson({
    maxTokens: 800,
    messages: [
      {
        content:
          "Canonicalize extracted work steps to known activities. Return JSON only.",
        role: "system",
      },
      { content: canonicalPrompt(unmatched, activities), role: "user" },
    ],
    responseFormat: {
      json_schema: {
        name: "ariadne_canonical_matches",
        schema: canonicalizationSchema,
        strict: true,
      },
      type: "json_schema",
    },
    task: "canonicalize",
    temperature: 0,
  });
  return parseCanonicalPayload(payload);
}

function newActivityFor(
  step: ExtractedStep,
  match: RawCanonicalMatch | undefined,
  activities: readonly ExtractionActivity[]
) {
  const proposedSlug =
    typeof match?.slug === "string" && slugPattern.test(match.slug)
      ? match.slug
      : step.activity_slug;
  const near = bestDeterministicMatch(proposedSlug, activities);
  if (near) {
    return near;
  }
  return {
    description:
      typeof match?.description === "string" ? match.description : step.intent,
    id: toActivityId(proposedSlug),
    label: typeof match?.label === "string" ? match.label : step.label,
    plane: "discovered" as const,
    slug: proposedSlug,
  };
}

function unionEvidence(primary: CanonicalizedStep, report: CanonicalizedStep) {
  const seen = new Set(primary.evidence.map((item) => item.ts));
  return [
    ...primary.evidence,
    ...report.evidence.filter((item) => !seen.has(item.ts)),
  ].sort((a, b) => a.received_at.localeCompare(b.received_at));
}

function evidenceOverlaps(a: CanonicalizedStep, b: CanonicalizedStep) {
  const evidence = new Set(a.evidence.map((item) => item.ts));
  return b.evidence.some((item) => evidence.has(item.ts));
}

function openState(step: CanonicalizedStep) {
  return (
    step.lifecycle_state === "committed" || step.lifecycle_state === "requested"
  );
}

function reconcileSteps(steps: readonly CanonicalizedStep[]) {
  const ordered = [...steps].sort(
    (a, b) =>
      a.ts_start.localeCompare(b.ts_start) ||
      a.seq - b.seq ||
      a.id.localeCompare(b.id)
  );
  const accepted: CanonicalizedStep[] = [];
  const reconciliation: PromiseReportReconciliation[] = [];
  for (const step of ordered) {
    const duplicate = accepted.find(
      (existing) =>
        existing.session_id === step.session_id &&
        existing.activity_id === step.activity_id &&
        existing.actor_person_id === step.actor_person_id &&
        evidenceOverlaps(existing, step)
    );
    if (duplicate) {
      reconciliation.push({
        report_step_id: step.id,
        resolution: "duplicate_dropped",
        source_step_id: duplicate.id,
      });
      continue;
    }
    if (step.modality === "reported") {
      const exactOpen = accepted.find(
        (existing) =>
          existing.session_id === step.session_id &&
          existing.activity_id === step.activity_id &&
          existing.actor_person_id === step.actor_person_id &&
          existing.artifact_id === step.artifact_id &&
          openState(existing)
      );
      const fulfilledRequest =
        exactOpen ??
        accepted.find(
          (existing) =>
            existing.session_id === step.session_id &&
            existing.activity_id === step.activity_id &&
            existing.lifecycle_state === "requested" &&
            existing.handoff_to_person_id === step.actor_person_id
        );
      if (fulfilledRequest) {
        fulfilledRequest.lifecycle_state = "done";
        fulfilledRequest.evidence = unionEvidence(fulfilledRequest, step);
        fulfilledRequest.confidence = Math.max(
          fulfilledRequest.confidence,
          step.confidence
        );
        fulfilledRequest.status =
          fulfilledRequest.confidence >= 0.4 ? "confirmed" : "proposed";
        reconciliation.push({
          report_step_id: step.id,
          resolution: "advanced",
          source_step_id: fulfilledRequest.id,
        });
        continue;
      }
      const priorDone = accepted.find(
        (existing) =>
          existing.session_id === step.session_id &&
          existing.activity_id === step.activity_id &&
          existing.actor_person_id === step.actor_person_id &&
          existing.lifecycle_state === "done"
      );
      if (priorDone) {
        accepted.push({ ...step, type: "rework" });
        continue;
      }
    }
    accepted.push({ ...step });
  }
  return { reconciliation, steps: accepted };
}

export async function canonicalize(
  steps: readonly ExtractedStep[],
  activities: readonly ExtractionActivity[],
  model?: ModelAdapter
): Promise<CanonicalizationResult> {
  const warnings: string[] = [];
  const nextActivities = [...activities];
  const canonicalSteps: CanonicalizedStep[] = [];
  const unmatched: ExtractedStep[] = [];
  for (const step of steps) {
    const match = bestDeterministicMatch(step.activity_slug, nextActivities);
    if (match) {
      canonicalSteps.push(attachActivity(step, match));
    } else {
      unmatched.push(step);
    }
  }
  let matches: RawCanonicalMatch[] = [];
  let modelCalls = 0;
  if (unmatched.length && model) {
    try {
      matches = await adjudicateUnmatched(unmatched, nextActivities, model);
      modelCalls = 1;
    } catch (error) {
      warnings.push(
        `canonicalize.model_failed:${
          error instanceof Error ? error.message : "unknown"
        }`
      );
    }
  }
  for (const step of unmatched) {
    const modelMatch = matches.find((match) => match.step_id === step.id);
    const existing =
      typeof modelMatch?.activity_id === "string"
        ? nextActivities.find(
            (candidateActivity) =>
              candidateActivity.id === modelMatch.activity_id
          )
        : undefined;
    const activity =
      existing ?? newActivityFor(step, modelMatch, nextActivities);
    if (!nextActivities.some((candidate) => candidate.id === activity.id)) {
      nextActivities.push(activity);
    }
    canonicalSteps.push(attachActivity(step, activity));
  }
  const reconciled = reconcileSteps(canonicalSteps);
  return {
    activities: nextActivities,
    degraded: false,
    modelCalls,
    reconciliation: reconciled.reconciliation,
    steps: reconciled.steps,
    warnings,
  };
}

export function graphEligibleSteps(steps: readonly CanonicalizedStep[]) {
  return steps.filter(
    (step) =>
      step.lifecycle_state === "done" &&
      step.status === "confirmed" &&
      !step.negated
  );
}
