import { describe, expect, it } from "vitest";
import {
  canonicalize,
  graphEligibleSteps,
} from "../server/mining/canonicalize.ts";
import { extract } from "../server/mining/extract.ts";
import type {
  ExtractedStep,
  ExtractionActivity,
  ExtractionContext,
  NormalizedObservation,
} from "../server/mining/types.ts";
import type { ModelAdapter, ModelJsonCall } from "../server/models.ts";

class FakeModel implements ModelAdapter {
  calls: ModelJsonCall[] = [];
  private readonly outputs: Array<Error | unknown>;
  constructor(outputs: Array<Error | unknown>) {
    this.outputs = outputs;
  }
  generateJson(call: ModelJsonCall) {
    this.calls.push(call);
    const output = this.outputs.shift();
    if (output instanceof Error) {
      return Promise.reject(output);
    }
    return Promise.resolve(output);
  }
}

const people = [
  { id: "per_priya" as const, name: "Priya Raman", role: "support" },
  { id: "per_tom" as const, name: "Tom Becker", role: "eng" },
  { id: "per_dana" as const, name: "Dana Okafor", role: "ceo" },
];

const activities: ExtractionActivity[] = [
  {
    id: "act_detect_incident",
    label: "Detect incident",
    plane: "designed",
    role_expected: "support",
    slug: "detect_incident",
  },
  {
    id: "act_triage_incident",
    label: "Triage incident",
    plane: "designed",
    role_expected: "support",
    slug: "triage_incident",
  },
  {
    id: "act_open_incident_ticket",
    label: "Open incident ticket",
    plane: "designed",
    role_expected: "support",
    slug: "open_incident_ticket",
  },
  {
    id: "act_assign_owner",
    label: "Assign owner",
    plane: "designed",
    role_expected: "pm",
    slug: "assign_owner",
  },
  {
    id: "act_security_review",
    label: "Security review",
    plane: "designed",
    role_expected: "eng",
    slug: "security_review",
  },
  {
    id: "act_improvise_hotfix",
    label: "Improvise hotfix",
    plane: "discovered",
    role_expected: "eng",
    slug: "improvise_hotfix",
  },
];

const context: ExtractionContext = {
  activities,
  artifacts: [{ id: "art_inc_4412", name: "INC-4412" }],
  people,
  role_repertoires: [
    {
      performs: [
        "act_detect_incident",
        "act_triage_incident",
        "act_open_incident_ticket",
      ],
      role_id: "support",
    },
    {
      performs: ["act_security_review", "act_improvise_hotfix"],
      role_id: "eng",
    },
    {
      performs: [],
      role_id: "ceo",
    },
  ],
};

function message(
  ts: string,
  author_person_id: NormalizedObservation["author_person_id"],
  text: string
): NormalizedObservation {
  const [seconds = "0", fraction = "0"] = ts.split(".");
  const receivedAt = new Date(
    Number(seconds) * 1000 + Number(fraction.padEnd(3, "0").slice(0, 3))
  ).toISOString();
  return {
    author_label:
      people.find((person) => person.id === author_person_id)?.name ??
      "Unknown",
    author_person_id,
    channel_id: "C123",
    received_at: receivedAt,
    revision: 1,
    session_id: "ses_helios_4412",
    text,
    ts,
    workspace_id: "T123",
  };
}

function step(
  activity_slug: string,
  actor_person_id: ExtractedStep["actor_person_id"],
  modality: ExtractedStep["modality"],
  evidence: ExtractedStep["evidence"],
  overrides: Partial<ExtractedStep> = {}
): ExtractedStep {
  const activity = activities.find(
    (candidate) => candidate.slug === activity_slug
  );
  const confidence = overrides.confidence ?? 0.8;
  let lifecycleState: ExtractedStep["lifecycle_state"];
  if (modality === "reported") {
    lifecycleState = "done";
  } else if (modality === "negated") {
    lifecycleState = "skipped";
  } else {
    lifecycleState = modality;
  }
  return {
    activity_id: activity?.id ?? null,
    activity_slug,
    actor_person_id,
    artifact_id: "art_inc_4412",
    confidence,
    evidence,
    handoff_to_person_id: null,
    id: `stp_${activity_slug}_${evidence.map((item) => item.ts).join("_")}`,
    intent: `Perform ${activity_slug}`,
    label: activity?.label ?? activity_slug,
    lifecycle_state: lifecycleState,
    modality,
    negated: modality === "negated",
    role_deviation: false,
    seq: evidence.length,
    session_id: "ses_helios_4412",
    status: confidence >= 0.4 ? "confirmed" : "proposed",
    ts_start: evidence[0]?.received_at ?? new Date(0).toISOString(),
    type: "action",
    ...overrides,
  };
}

describe("step extraction", () => {
  it("returns no steps for chatter without inventing work", async () => {
    const model = new FakeModel([{ steps: [] }]);
    const result = await extract(
      [message("1757671000.000100", "per_priya", "thanks, looking now")],
      [],
      context,
      model
    );
    expect(result.steps).toEqual([]);
    expect(result.degraded).toBe(false);
    expect(result.modelCalls).toBe(1);
  });

  it("retries invalid model output once and then degrades", async () => {
    const model = new FakeModel([
      new Error("invalid json"),
      new Error("still invalid"),
    ]);
    const result = await extract(
      [message("1757671000.000100", "per_priya", "opening INC-4412")],
      [],
      context,
      model
    );
    expect(result).toMatchObject({ degraded: true, modelCalls: 2, steps: [] });
    expect(result.warnings).toHaveLength(2);
  });

  it("drops steps whose evidence is not in the current window", async () => {
    const model = new FakeModel([
      {
        steps: [
          {
            activity_slug: "open_incident_ticket",
            actor_person_id: "per_priya",
            artifact_id: "art_inc_4412",
            confidence: 0.9,
            evidence: ["1757679999.000999"],
            handoff_to_person_id: null,
            intent: "Open the incident ticket",
            label: "Open incident ticket",
            modality: "reported",
            type: "action",
          },
        ],
      },
    ]);
    const result = await extract(
      [message("1757671000.000100", "per_priya", "opening INC-4412")],
      [],
      context,
      model
    );
    expect(result.steps).toEqual([]);
    expect(result.warnings).toContain(
      "extract.dropped_invalid_or_duplicate_steps"
    );
  });

  it("materializes modality, curation state and role confidence", async () => {
    const model = new FakeModel([
      {
        steps: [
          {
            activity_slug: "assign_owner",
            actor_person_id: "per_dana",
            artifact_id: "art_inc_4412",
            confidence: 0.9,
            evidence: ["1757671000.000100"],
            handoff_to_person_id: "per_tom",
            intent: "Assign the incident owner",
            label: "Assign owner",
            modality: "reported",
            type: "handoff",
          },
        ],
      },
    ]);
    const result = await extract(
      [
        message(
          "1757671000.000100",
          "per_dana",
          "assigned Tom to this incident"
        ),
      ],
      [],
      context,
      model
    );
    expect(result.steps[0]).toMatchObject({
      activity_id: "act_assign_owner",
      lifecycle_state: "done",
      role_deviation: true,
      status: "confirmed",
    });
    expect(result.steps[0]?.confidence).toBeCloseTo(0.72);
  });
});

describe("canonicalization and reconciliation", () => {
  it("uses one batched model call for unmatched slugs and creates discovered activities", async () => {
    const evidence = [
      message("1757671000.000100", "per_tom", "I patched it"),
    ].map((item) => ({
      channel_id: item.channel_id,
      message_revision: item.revision,
      received_at: item.received_at,
      text: item.text,
      ts: item.ts,
      workspace_id: item.workspace_id,
    }));
    const unmatched = step("patch_checkout", "per_tom", "reported", evidence, {
      activity_id: null,
      label: "Patch checkout",
    });
    const model = new FakeModel([
      {
        matches: [
          {
            activity_id: null,
            description: "Patch checkout without full root cause",
            label: "Patch checkout",
            slug: "patch_checkout",
            step_id: unmatched.id,
          },
        ],
      },
    ]);
    const result = await canonicalize([unmatched], activities, model);
    expect(result.modelCalls).toBe(1);
    expect(result.steps[0]?.activity_id).toBe("act_patch_checkout");
    expect(
      result.activities.some((activity) => activity.slug === "patch_checkout")
    ).toBe(true);
  });

  it("merges near-duplicate slugs deterministically before spending a model call", async () => {
    const evidence = [
      message("1757671000.000100", "per_tom", "skipping the review"),
    ].map((item) => ({
      channel_id: item.channel_id,
      message_revision: item.revision,
      received_at: item.received_at,
      text: item.text,
      ts: item.ts,
      workspace_id: item.workspace_id,
    }));
    const result = await canonicalize(
      [
        step("security_revew", "per_tom", "negated", evidence, {
          activity_id: null,
        }),
      ],
      activities,
      new FakeModel([{ matches: [] }])
    );
    expect(result.modelCalls).toBe(0);
    expect(result.steps[0]?.activity_id).toBe("act_security_review");
    expect(graphEligibleSteps(result.steps)).toEqual([]);
  });

  it("reconciles the seven-utterance work-model example", async () => {
    const messages = [
      message(
        "1757671001.000100",
        "per_priya",
        "vertex checkout throwing 500s"
      ),
      message("1757671002.000100", "per_priya", "calling this a P1"),
      message("1757671003.000100", "per_priya", "opening INC-4412"),
      message("1757671004.000100", "per_dana", "assigned Tom to this incident"),
      message("1757671005.000100", "per_tom", "i'll push a mitigation"),
      message(
        "1757671006.000100",
        "per_tom",
        "skipping the security checklist"
      ),
      message(
        "1757671007.000100",
        "per_tom",
        "the mitigation hotfix is now live"
      ),
    ];
    const refs = messages.map((item) => ({
      channel_id: item.channel_id,
      message_revision: item.revision,
      received_at: item.received_at,
      text: item.text,
      ts: item.ts,
      workspace_id: item.workspace_id,
    }));
    const rawSteps = [
      step("detect_incident", "per_priya", "reported", [
        refs[0] as NonNullable<(typeof refs)[0]>,
      ]),
      step(
        "triage_incident",
        "per_priya",
        "reported",
        [refs[1] as NonNullable<(typeof refs)[1]>],
        { type: "decision" }
      ),
      step("open_incident_ticket", "per_priya", "reported", [
        refs[2] as NonNullable<(typeof refs)[2]>,
      ]),
      step(
        "assign_owner",
        "per_dana",
        "reported",
        [refs[3] as NonNullable<(typeof refs)[3]>],
        {
          handoff_to_person_id: "per_tom",
          type: "handoff",
        }
      ),
      step("improvise_hotfix", "per_tom", "committed", [
        refs[4] as NonNullable<(typeof refs)[4]>,
      ]),
      step("security_review", "per_tom", "negated", [
        refs[5] as NonNullable<(typeof refs)[5]>,
      ]),
      step("improvise_hotfix", "per_tom", "reported", [
        refs[6] as NonNullable<(typeof refs)[6]>,
      ]),
    ];
    const result = await canonicalize(rawSteps, activities);
    expect(result.steps).toHaveLength(6);
    expect(result.reconciliation).toContainEqual({
      report_step_id: rawSteps[6]?.id,
      resolution: "advanced",
      source_step_id: rawSteps[4]?.id,
    });
    expect(
      result.steps.find(
        (candidate) => candidate.activity_slug === "improvise_hotfix"
      )?.lifecycle_state
    ).toBe("done");
    expect(
      graphEligibleSteps(result.steps).map(
        (candidate) => candidate.activity_slug
      )
    ).toEqual([
      "detect_incident",
      "triage_incident",
      "open_incident_ticket",
      "assign_owner",
      "improvise_hotfix",
    ]);
  });
});
