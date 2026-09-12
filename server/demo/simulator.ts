import type {
  ChannelId,
  ISODateTime,
  Message,
  MessageId,
  Person,
  PersonId,
  ProcessSessionId,
  ProjectId,
  SlackTs,
  WorkflowId,
  WorkspaceId,
} from "../../shared/contracts.ts";
import {
  fixturePeople,
  fixtureProjects,
  fixtureWorkflows,
} from "../../shared/fixtures.ts";
import type { NormalizedObservation } from "../mining/types.ts";

export type ScenarioId = "atlas_feature" | "helios_p1";
export type ScenarioVariantId =
  | "v1_by_the_book"
  | "v2_roadmap_bypass"
  | "v2_skip_review"
  | "v3_rework";

export interface DemoAgenda {
  bypasses: string[];
  deviates_as: string[];
  objective: string;
  pressure: string;
  process_belief: string[];
  tell: string;
}

export interface DemoScenarioVariant {
  expected_deviations: string[];
  introduces: string[];
  label: string;
  messages: Array<{
    delay: number;
    person_id: PersonId;
    text: string;
  }>;
}

export interface DemoScenario {
  agendas: Partial<Record<PersonId, DemoAgenda>>;
  channel: ChannelId;
  channel_name: string;
  id: ScenarioId;
  project_id: ProjectId;
  variants: Partial<Record<ScenarioVariantId, DemoScenarioVariant>>;
  workflow_id: WorkflowId;
  workspace_id: WorkspaceId;
}

export interface DemoTranscriptMessage {
  delay: number;
  person_id: PersonId;
  text: string;
}

export interface DemoTranscript {
  expected_deviations: string[];
  messages: DemoTranscriptMessage[];
  project_id: ProjectId;
  scenario_id: ScenarioId;
  seed: number;
  variant: ScenarioVariantId;
  workflow_id: WorkflowId;
}

export interface GeneratedTranscriptSet {
  transcripts: DemoTranscript[];
  validation: TranscriptValidation[];
}

export interface TranscriptValidation {
  errors: string[];
  scenario_id: ScenarioId;
  valid: boolean;
  variant: ScenarioVariantId;
  warnings: string[];
}

export interface ObservationSequence {
  messages: Message[];
  observations: NormalizedObservation[];
  session: {
    ended_ts: ISODateTime;
    id: ProcessSessionId;
    started_ts: ISODateTime;
  };
}

const forbiddenMessageFields = new Set([
  "action",
  "activity_id",
  "activity_slug",
  "actor",
  "actor_person_id",
  "case_id",
  "intent",
  "label",
  "lifecycle_state",
  "modality",
  "role",
  "seq",
  "status",
  "type",
]);

const transcriptActivitySlug = /\b[a-z][a-z0-9]*_[a-z0-9_]+\b/;
const aiNarration = /as an ai|i am an ai/i;

export const demoScenarios: DemoScenario[] = [
  {
    agendas: {
      per_dana: {
        bypasses: ["assign_owner", "security_review"],
        deviates_as: ["escalate_to_ceo"],
        objective: "Keep the Vertex renewal.",
        pressure: "Every hour of checkout downtime weakens the renewal call.",
        process_belief: ["triage_incident", "deploy_fix", "notify_customer"],
        tell: "Overrules hesitation with customer urgency.",
      },
      per_lea: {
        bypasses: [],
        deviates_as: [],
        objective: "Keep the incident record auditable.",
        pressure: "The team wants to move faster than the policy allows.",
        process_belief: ["security_review", "write_postmortem"],
        tell: "Asks for proof and cites the required checklist.",
      },
      per_marc: {
        bypasses: ["verify_resolution"],
        deviates_as: ["hold_customer_call"],
        objective: "Keep Vertex informed before the renewal call.",
        pressure: "The account team needs an answer immediately.",
        process_belief: ["assign_owner", "notify_customer"],
        tell: "Turns technical status into customer-facing commitments.",
      },
      per_priya: {
        bypasses: [],
        deviates_as: [],
        objective: "Protect the SLA clock and get the incident owned.",
        pressure: "Support is seeing checkout failures climb by the minute.",
        process_belief: [
          "detect_incident",
          "triage_incident",
          "verify_resolution",
        ],
        tell: "States timestamps, symptoms and customer impact.",
      },
      per_tom: {
        bypasses: ["security_review"],
        deviates_as: ["improvise_hotfix"],
        objective: "Ship a correct fix without creating another incident.",
        pressure: "Executives are asking him to skip review.",
        process_belief: [
          "reproduce_issue",
          "root_cause_analysis",
          "security_review",
          "deploy_fix",
        ],
        tell: "Names risk once, then reports the production action.",
      },
    },
    channel: "C_HELIOS_OPS",
    channel_name: "ops-war-room",
    id: "helios_p1",
    project_id: "proj_helios",
    variants: {
      v1_by_the_book: {
        expected_deviations: [],
        introduces: [],
        label: "Textbook run",
        messages: [
          {
            delay: 1.2,
            person_id: "per_priya",
            text: "Vertex checkout has been throwing 500s since 09:14 and volume is still climbing.",
          },
          {
            delay: 1.4,
            person_id: "per_priya",
            text: "Calling this a P1 because the SLA clock is running and revenue is impacted.",
          },
          {
            delay: 1.3,
            person_id: "per_priya",
            text: "I opened INC-4412 and attached the dashboard snapshot.",
          },
          {
            delay: 1.5,
            person_id: "per_marc",
            text: "Tom is the incident owner; target is mitigation inside four hours.",
          },
          {
            delay: 1.6,
            person_id: "per_tom",
            text: "I reproduced it on the staging replica using the Vertex merchant config.",
          },
          {
            delay: 1.4,
            person_id: "per_tom",
            text: "Root cause is a null merchant id in the 3DS callback.",
          },
          {
            delay: 1.3,
            person_id: "per_tom",
            text: "Security checklist passed, signed off in the checklist doc.",
          },
          {
            delay: 1.7,
            person_id: "per_tom",
            text: "The fix is deployed to prod now.",
          },
          {
            delay: 1.2,
            person_id: "per_priya",
            text: "Vertex error rate is back to baseline for the last ten minutes.",
          },
          {
            delay: 1.4,
            person_id: "per_marc",
            text: "I emailed Vertex with the timeline and mitigation notes.",
          },
          {
            delay: 1.3,
            person_id: "per_lea",
            text: "Who is taking the postmortem writeup before we close this?",
          },
        ],
      },
      v2_skip_review: {
        expected_deviations: [
          "escalate_to_ceo",
          "improvise_hotfix",
          "hold_customer_call",
        ],
        introduces: [
          "improvise_hotfix",
          "hold_customer_call",
          "pol_sec_review",
        ],
        label: "Pressure run - review skipped",
        messages: [
          {
            delay: 1.2,
            person_id: "per_priya",
            text: "Vertex checkout 500s are climbing again and the renewal is in November.",
          },
          {
            delay: 1.4,
            person_id: "per_dana",
            text: "This is our biggest logo. I need a fix now; Tom, jump on it directly.",
          },
          {
            delay: 1.5,
            person_id: "per_tom",
            text: "I can push a mitigation before we know the root cause, but that carries risk.",
          },
          {
            delay: 1.2,
            person_id: "per_tom",
            text: "I am skipping the security checklist to save time.",
          },
          {
            delay: 1.5,
            person_id: "per_lea",
            text: "That checklist is mandatory for production changes.",
          },
          {
            delay: 1.3,
            person_id: "per_dana",
            text: "Ship it, we will review after the customer is stable.",
          },
          {
            delay: 1.6,
            person_id: "per_tom",
            text: "Hotfix is out and the production fix is deployed.",
          },
          {
            delay: 1.2,
            person_id: "per_marc",
            text: "I am calling Vertex now before we finish verification.",
          },
          {
            delay: 1.4,
            person_id: "per_priya",
            text: "Errors dropped to baseline across the last five checks.",
          },
        ],
      },
      v3_rework: {
        expected_deviations: ["rework_edge"],
        introduces: ["rework_edge"],
        label: "Rework run - first fix fails",
        messages: [
          {
            delay: 1.1,
            person_id: "per_priya",
            text: "Vertex checkout 500s are back on a smaller set of cards.",
          },
          {
            delay: 1.4,
            person_id: "per_marc",
            text: "Tom owns the incident while Priya keeps the customer update thread clean.",
          },
          {
            delay: 1.7,
            person_id: "per_tom",
            text: "Root cause looked like the 3DS callback, and I deployed the first fix.",
          },
          {
            delay: 1.6,
            person_id: "per_priya",
            text: "Verification failed; the error rate dipped, then spiked again.",
          },
          {
            delay: 1.7,
            person_id: "per_tom",
            text: "I found the second cause in the merchant cache and deployed the corrected fix.",
          },
          {
            delay: 1.3,
            person_id: "per_priya",
            text: "Verification passes now and the incident is resolved.",
          },
        ],
      },
    },
    workflow_id: "wf_p1_incident",
    workspace_id: "T_ARIADNEOS_DEMO",
  },
  {
    agendas: {
      per_dana: {
        bypasses: ["roadmap_review"],
        deviates_as: ["negotiate_scope_offline"],
        objective: "Keep Vertex expansion moving.",
        pressure: "The account asks for a commitment before planning finishes.",
        process_belief: ["capture_request", "update_roadmap"],
        tell: "Makes commitments first and asks process to catch up.",
      },
      per_marc: {
        bypasses: [],
        deviates_as: [],
        objective: "Make the customer request explicit.",
        pressure: "Sales wants an answer before effort is clear.",
        process_belief: ["capture_request", "estimate_effort"],
        tell: "Names the account, ticket and next planning step.",
      },
      per_sofia: {
        bypasses: [],
        deviates_as: [],
        objective: "Protect the Q4 roadmap.",
        pressure: "Executive pressure is building around Vertex.",
        process_belief: ["qualify_business_case", "roadmap_review"],
        tell: "States decisions crisply and asks for evidence.",
      },
      per_tom: {
        bypasses: [],
        deviates_as: [],
        objective: "Keep engineering effort explicit.",
        pressure: "The scope can balloon if no estimate is recorded.",
        process_belief: ["estimate_effort", "create_epic"],
        tell: "Translates scope into engineering weeks.",
      },
    },
    channel: "C_ATLAS_ROADMAP",
    channel_name: "atlas-roadmap",
    id: "atlas_feature",
    project_id: "proj_atlas",
    variants: {
      v1_by_the_book: {
        expected_deviations: [],
        introduces: [],
        label: "Textbook feature intake",
        messages: [
          {
            delay: 1.2,
            person_id: "per_marc",
            text: "Captured REQ-88 for Vertex SSO in the billing portal.",
          },
          {
            delay: 1.4,
            person_id: "per_sofia",
            text: "Business case is qualified; the request protects expansion revenue.",
          },
          {
            delay: 1.5,
            person_id: "per_marc",
            text: "Engineering estimate is three weeks if we reuse the enterprise auth path.",
          },
          {
            delay: 1.3,
            person_id: "per_sofia",
            text: "Roadmap review is approved for Q4.",
          },
          {
            delay: 1.4,
            person_id: "per_dana",
            text: "Approved from exec side given the expansion risk.",
          },
          {
            delay: 1.2,
            person_id: "per_sofia",
            text: "I added it to the Q4 roadmap.",
          },
          {
            delay: 1.2,
            person_id: "per_marc",
            text: "I communicated the decision back to Vertex.",
          },
          {
            delay: 1.3,
            person_id: "per_marc",
            text: "Created the epic and linked the estimate.",
          },
        ],
      },
      v2_roadmap_bypass: {
        expected_deviations: ["negotiate_scope_offline"],
        introduces: ["negotiate_scope_offline", "pol_roadmap_review"],
        label: "Roadmap bypass",
        messages: [
          {
            delay: 1.2,
            person_id: "per_marc",
            text: "Captured REQ-88 for Vertex SSO in the billing portal.",
          },
          {
            delay: 1.4,
            person_id: "per_dana",
            text: "I already promised Vertex we will add SSO this quarter.",
          },
          {
            delay: 1.5,
            person_id: "per_marc",
            text: "That sounds like at least three engineering weeks.",
          },
          {
            delay: 1.3,
            person_id: "per_sofia",
            text: "Roadmap review needs to happen before this goes into Q4.",
          },
          {
            delay: 1.4,
            person_id: "per_marc",
            text: "I updated the customer note with the promised timing.",
          },
          {
            delay: 1.2,
            person_id: "per_marc",
            text: "Created a provisional epic so we can scope the work.",
          },
        ],
      },
    },
    workflow_id: "wf_feature_intake",
    workspace_id: "T_ARIADNEOS_DEMO",
  },
];

export function demoScenarioCatalog() {
  return demoScenarios.map((scenario) => ({
    channel: scenario.channel,
    channel_name: scenario.channel_name,
    id: scenario.id,
    project_id: scenario.project_id,
    variants: Object.entries(scenario.variants).map(([id, variant]) => ({
      expected_deviations: variant?.expected_deviations ?? [],
      id,
      introduces: variant?.introduces ?? [],
      label: variant?.label ?? id,
    })),
    workflow_id: scenario.workflow_id,
    workspace_id: scenario.workspace_id,
  }));
}

export function generateDemoTranscripts(
  options: { seed?: number } = {}
): GeneratedTranscriptSet {
  const seed = options.seed ?? 28;
  const transcripts = demoScenarios.flatMap((scenario, scenarioIndex) =>
    Object.entries(scenario.variants).map(([variantId, variant], index) => {
      if (!variant) {
        throw new Error(
          `Missing scenario variant: ${scenario.id}/${variantId}`
        );
      }
      return generateDemoTranscript(
        scenario.id,
        variantId as ScenarioVariantId,
        seed + scenarioIndex * 100 + index
      );
    })
  );
  return {
    transcripts,
    validation: transcripts.map(validateDemoTranscript),
  };
}

export function generateDemoTranscript(
  scenarioId: ScenarioId,
  variantId: ScenarioVariantId,
  seed = 28
): DemoTranscript {
  const scenario = scenarioById(scenarioId);
  const variant = scenario.variants[variantId];
  if (!variant) {
    throw new Error(
      `Unknown demo scenario variant: ${scenarioId}/${variantId}`
    );
  }
  const random = seededRandom(seed);
  return {
    expected_deviations: [...variant.expected_deviations],
    messages: variant.messages.map((message, index) => ({
      delay: Number(
        (message.delay + random() * 0.25 + index * 0.01).toFixed(2)
      ),
      person_id: message.person_id,
      text: message.text,
    })),
    project_id: scenario.project_id,
    scenario_id: scenario.id,
    seed,
    variant: variantId,
    workflow_id: scenario.workflow_id,
  };
}

export function validateDemoTranscript(
  transcript: DemoTranscript
): TranscriptValidation {
  const errors: string[] = [];
  const warnings: string[] = [];
  const scenario = demoScenarios.find(
    (candidate) => candidate.id === transcript.scenario_id
  );
  const variant = scenario?.variants[transcript.variant];
  if (!scenario) {
    errors.push(`unknown_scenario:${transcript.scenario_id}`);
  }
  if (!variant) {
    errors.push(`unknown_variant:${transcript.variant}`);
  }
  if (scenario && transcript.project_id !== scenario.project_id) {
    errors.push("project_mismatch");
  }
  if (scenario && transcript.workflow_id !== scenario.workflow_id) {
    errors.push("workflow_mismatch");
  }
  if (transcript.messages.length === 0) {
    errors.push("messages_empty");
  }
  const expected = new Set(variant?.expected_deviations ?? []);
  const actual = new Set(transcript.expected_deviations);
  for (const deviation of expected) {
    if (!actual.has(deviation)) {
      errors.push(`expected_deviation_missing:${deviation}`);
    }
  }
  for (const deviation of actual) {
    const matches = Object.values(scenario?.agendas ?? {}).filter(
      (agenda) =>
        agenda?.bypasses.includes(deviation) ||
        agenda?.deviates_as.includes(deviation) ||
        agenda?.process_belief.includes(deviation)
    );
    if (deviation !== "rework_edge" && matches.length !== 1) {
      errors.push(`deviation_not_traceable_once:${deviation}`);
    }
  }
  transcript.messages.forEach((message, index) => {
    validateMessageKeys(message, index, errors);
    if (!Number.isFinite(message.delay) || message.delay < 0.5) {
      errors.push(`message_${index}_delay_invalid`);
    }
    const person = fixturePeople.find(
      (candidate) => candidate.id === message.person_id
    );
    if (!person) {
      errors.push(`message_${index}_unknown_person:${message.person_id}`);
    } else if (!person.project_ids.includes(transcript.project_id)) {
      errors.push(
        `message_${index}_person_project_mismatch:${message.person_id}`
      );
    }
    if (message.text.length > 320) {
      errors.push(`message_${index}_too_long`);
    }
    if (transcriptActivitySlug.test(message.text)) {
      errors.push(`message_${index}_contains_activity_slug`);
    }
    if (aiNarration.test(message.text)) {
      errors.push(`message_${index}_ai_narration`);
    }
  });
  const distinctSpeakers = new Set(
    transcript.messages.map((message) => message.person_id)
  ).size;
  if (distinctSpeakers < 3) {
    warnings.push("low_persona_diversity");
  }
  return {
    errors,
    scenario_id: transcript.scenario_id,
    valid: errors.length === 0,
    variant: transcript.variant,
    warnings,
  };
}

export function transcriptToObservationSequence(
  transcript: DemoTranscript,
  options: {
    start?: Date;
    workspaceId?: WorkspaceId;
  } = {}
): ObservationSequence {
  const validation = validateDemoTranscript(transcript);
  if (!validation.valid) {
    throw new Error(`Invalid transcript: ${validation.errors.join(", ")}`);
  }
  const scenario = scenarioById(transcript.scenario_id);
  const sessionId =
    `ses_${transcript.scenario_id}_${transcript.variant}_${transcript.seed}` as ProcessSessionId;
  const start = options.start ?? new Date("2026-09-12T09:14:00.000Z");
  const workspaceId = options.workspaceId ?? scenario.workspace_id;
  let elapsedSeconds = 0;
  const observations = transcript.messages.map((message, index) => {
    elapsedSeconds += message.delay;
    const receivedAt = new Date(
      start.getTime() + Math.round(elapsedSeconds * 1000)
    ).toISOString();
    const ts = slackTs(start, elapsedSeconds, index);
    const person = personById(message.person_id);
    return {
      author_label: person.name,
      author_person_id: message.person_id,
      channel_id: scenario.channel,
      id: messageId(workspaceId, scenario.channel, ts),
      is_agent: false,
      permalink: slackPermalink(scenario.channel, ts, scenario.channel_name),
      received_at: receivedAt,
      revision: 1,
      session_id: sessionId,
      text: message.text,
      thread_ts: null,
      ts,
      workspace_id: workspaceId,
    } satisfies NormalizedObservation;
  });
  return {
    messages: observations.map((observation) => toContractMessage(observation)),
    observations,
    session: {
      ended_ts:
        observations.at(-1)?.received_at ?? new Date(start).toISOString(),
      id: sessionId,
      started_ts: observations[0]?.received_at ?? start.toISOString(),
    },
  };
}

export function scenarioById(id: ScenarioId): DemoScenario {
  const scenario = demoScenarios.find((candidate) => candidate.id === id);
  if (!scenario) {
    throw new Error(`Unknown demo scenario: ${id}`);
  }
  return scenario;
}

export function workflowForScenario(scenario: DemoScenario) {
  const workflow = fixtureWorkflows.find(
    (candidate) => candidate.id === scenario.workflow_id
  );
  if (!workflow) {
    throw new Error(`Missing workflow for scenario: ${scenario.id}`);
  }
  return workflow;
}

export function projectName(projectId: ProjectId) {
  return (
    fixtureProjects.find((project) => project.id === projectId)?.name ??
    projectId
  );
}

function validateMessageKeys(
  message: DemoTranscriptMessage,
  index: number,
  errors: string[]
) {
  for (const key of Object.keys(message)) {
    if (forbiddenMessageFields.has(key)) {
      errors.push(`message_${index}_forbidden_field:${key}`);
    }
  }
}

function toContractMessage(observation: NormalizedObservation): Message {
  return {
    author_label: observation.author_label,
    author_person_id: observation.author_person_id,
    availability: observation.deleted ? "deleted" : "available",
    channel: observation.channel_id,
    deleted: observation.deleted ?? false,
    id: observation.id as MessageId,
    is_agent: observation.is_agent ?? false,
    permalink: observation.permalink ?? "",
    received_at: observation.received_at,
    revision: observation.revision,
    session_id: observation.session_id as ProcessSessionId,
    text: observation.text,
    thread_ts: observation.thread_ts ?? null,
    ts: observation.ts as SlackTs,
    workspace_id: observation.workspace_id,
  };
}

function slackTs(start: Date, elapsedSeconds: number, index: number): SlackTs {
  const seconds = Math.floor(start.getTime() / 1000 + elapsedSeconds);
  return `${seconds}.${String((index + 1) * 1000).padStart(6, "0")}`;
}

function slackPermalink(channel: ChannelId, ts: string, channelName: string) {
  return `https://ariadneos.slack.com/archives/${channel}/p${ts.replace(".", "")}?channel=${encodeURIComponent(channelName)}`;
}

function messageId(
  workspaceId: WorkspaceId,
  channel: ChannelId,
  ts: string
): MessageId {
  return `${workspaceId}:${channel}:${ts}` as MessageId;
}

function personById(id: PersonId): Person {
  const person = fixturePeople.find((candidate) => candidate.id === id);
  if (!person) {
    throw new Error(`Unknown demo person: ${id}`);
  }
  return person;
}

function seededRandom(seed: number) {
  // biome-ignore lint/suspicious/noBitwiseOperators: deterministic unsigned 32-bit PRNG for stable demo delays.
  let state = seed >>> 0;
  return () => {
    // biome-ignore lint/suspicious/noBitwiseOperators: deterministic unsigned 32-bit PRNG for stable demo delays.
    state = (Math.imul(state, 1_664_525) + 1_013_904_223) >>> 0;
    return state / 4_294_967_296;
  };
}
