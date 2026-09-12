export type ActivityId = `act_${string}`;
export type ArtifactId = `art_${string}`;
export type CurationStatus = "confirmed" | "proposed" | "rejected";
export type LifecycleState =
  | "abandoned"
  | "committed"
  | "done"
  | "failed"
  | "in_progress"
  | "requested"
  | "skipped";
export type Modality = "committed" | "negated" | "reported" | "requested";
export type PersonId = `per_${string}`;
export type ProcessSessionId = `ses_${string}` | string;
export type RoleId = "ceo" | "cpo" | "eng" | "pm" | "pmo" | "support" | string;
export type StepId = `stp_${string}`;
export type StepType =
  | "action"
  | "approval"
  | "decision"
  | "handoff"
  | "rework"
  | "wait";

export interface NormalizedObservation {
  author_label: string;
  author_person_id: PersonId | null;
  channel_id: string;
  deleted?: boolean;
  id?: string;
  is_agent?: boolean;
  permalink?: string;
  received_at: string;
  revision: number;
  session_id: ProcessSessionId;
  text: string;
  thread_ts?: string | null;
  ts: string;
  workspace_id: string;
}

export interface ExtractionActivity {
  description?: string;
  id: ActivityId;
  label: string;
  plane?: "both" | "designed" | "discovered";
  role_expected?: RoleId | null;
  slug: string;
}

export interface ExtractionArtifact {
  id: ArtifactId;
  name: string;
}

export interface ExtractionPerson {
  id: PersonId;
  name: string;
  role: RoleId;
}

export interface RoleRepertoire {
  never_performs?: readonly ActivityId[];
  performs: readonly ActivityId[];
  role_id: RoleId;
}

export interface ExtractionContext {
  activities: readonly ExtractionActivity[];
  artifacts: readonly ExtractionArtifact[];
  people: readonly ExtractionPerson[];
  role_repertoires?: readonly RoleRepertoire[];
}

export interface EvidenceRef {
  channel_id: string;
  message_revision: number;
  received_at: string;
  text: string;
  ts: string;
  workspace_id: string;
}

export interface ExtractedStep {
  activity_id: ActivityId | null;
  activity_slug: string;
  actor_person_id: PersonId | null;
  artifact_id: ArtifactId | null;
  confidence: number;
  evidence: EvidenceRef[];
  handoff_to_person_id: PersonId | null;
  id: StepId;
  intent: string;
  label: string;
  lifecycle_state: LifecycleState;
  modality: Modality;
  negated: boolean;
  role_deviation: boolean;
  seq: number;
  session_id: ProcessSessionId;
  status: CurationStatus;
  ts_start: string;
  type: StepType;
}

export interface PromiseReportReconciliation {
  report_step_id: StepId;
  resolution: "advanced" | "duplicate_dropped" | "unmatched";
  source_step_id: StepId;
}

export interface MiningResult<TStep extends ExtractedStep = ExtractedStep> {
  degraded: boolean;
  modelCalls: number;
  steps: TStep[];
  warnings: string[];
}

export const slugPattern = /^[a-z][a-z0-9_]{2,40}$/;
