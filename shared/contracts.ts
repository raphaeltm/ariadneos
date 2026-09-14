export type EntityId =
  | ActivityId
  | ArtifactId
  | MessageId
  | PersonId
  | PolicyId
  | ProcessSessionId
  | ProjectId
  | StepId
  | WorkflowId;

export type ActivityId = `act_${string}`;
export type ArtifactId = `art_${string}`;
export type GraphEdgeId = `ged_${string}`;
export type JournalId = number;
export type MessageId = `${WorkspaceId}:${ChannelId}:${SlackTs}`;
export type PersonId = `per_${string}`;
export type PolicyId = `pol_${string}`;
export type ProcessSessionId = `ses_${string}`;
export type ProjectId = `proj_${string}`;
export type StepId = `stp_${string}`;
export type WorkflowId = `wf_${string}`;

export type ChannelId = string;
export type ISODateTime = string;
export type SlackTs = string;
export type WorkspaceId = string;

export type ArtifactLifecycleState =
  | "approved"
  | "captured"
  | "detected"
  | "draft"
  | "estimated"
  | "mitigated"
  | "owned"
  | "post-mortemed"
  | "proposed"
  | "published"
  | "qualified"
  | "resolved"
  | "reviewed"
  | "scheduled"
  | "signed"
  | "triaged";
export type ArtifactType =
  | "contract"
  | "dashboard"
  | "doc"
  | "incident"
  | "repo"
  | "ticket";
export type CommandKind =
  | "confirm_step"
  | "rebuild_graph"
  | "reject_step";
export type CurationStatus = "confirmed" | "proposed" | "rejected";
export type EvidenceAvailability = "available" | "deleted" | "redacted";
export type FollowKind =
  | "approval"
  | "decision"
  | "handoff"
  | "rework"
  | "sequence";
export type GraphPlane = "both" | "designed" | "discovered";
export type GraphViewKind = "designed" | "discovered" | "instance" | "overlay";
export type JournalEventKind =
  | "agent_post"
  | "conformance"
  | "graph_delta"
  | "message"
  | "paused"
  | "reset"
  | "resumed"
  | "session_closed"
  | "session_started"
  | "step";
export type LifecycleState =
  | "abandoned"
  | "committed"
  | "done"
  | "failed"
  | "in_progress"
  | "requested"
  | "skipped";
export type Modality = "committed" | "negated" | "reported" | "requested";
export type OutboxStatus = "failed" | "pending" | "sent" | "uncertain";
export type PolicyKind = "approval" | "mandatory" | "ordering" | "threshold";
export type ProcessingStatus = "done" | "error" | "pending";
/** Workspace-authored role identifier, derived from a workflow activity's role. */
export type RoleId = string;
export type SessionSource = "human";
export type SessionStatus = "closed" | "open";
export type StepType =
  | "action"
  | "approval"
  | "decision"
  | "handoff"
  | "rework"
  | "wait";

export interface ScopedRef {
  channel: ChannelId;
  workspace_id: WorkspaceId;
}

export interface Role {
  id: RoleId;
  name: string;
}

export interface RoleRepertoire {
  never_performs: ActivityId[];
  performs: ActivityId[];
  role_id: RoleId;
}

export interface Person {
  biases: string[];
  color: string;
  comms_style: string;
  emoji: string;
  goals: string[];
  id: PersonId;
  name: string;
  project_ids: ProjectId[];
  role: RoleId;
  seniority: string;
}

export interface Project {
  constraints: string[];
  id: ProjectId;
  name: string;
  spec_md: string;
  summary: string;
  workflow_id: WorkflowId;
}

export interface Artifact {
  current_state?: ArtifactLifecycleState;
  id: ArtifactId;
  name: string;
  project_id: ProjectId;
  type: ArtifactType;
  unit?: string;
  uri?: string;
  value?: number;
}

export interface ArtifactLifecycleDefinition {
  artifact_type: ArtifactType;
  states: ArtifactLifecycleState[];
  transitions: ArtifactLifecycleTransition[];
}

export interface ArtifactLifecycleTransition {
  activity_id: ActivityId;
  from: ArtifactLifecycleState;
  to: ArtifactLifecycleState;
}

export interface Policy {
  activity_slug: string;
  id: PolicyId;
  kind: PolicyKind;
  params: Record<string, number | string | string[]>;
  project_id: ProjectId;
  text: string;
}

export interface Activity {
  authored_synonyms: string[];
  description: string;
  first_seen_ts?: ISODateTime;
  id: ActivityId;
  label: string;
  occurrences: number;
  plane: GraphPlane;
  policy_ids: PolicyId[];
  project_id: ProjectId | null;
  role_expected: RoleId | null;
  roles_observed: RoleId[];
  slug: string;
  support: number;
}

export interface WorkflowActivity {
  activity_id: ActivityId;
  rank: number;
  role_expected: RoleId;
  workflow_id: WorkflowId;
}

export interface Workflow {
  activity_slugs: string[];
  entry_activity: string;
  exit_activities: string[];
  id: WorkflowId;
  matrix: number[][];
  name: string;
  plane: Exclude<GraphPlane, "both">;
  policy_ids: PolicyId[];
  project_id: ProjectId;
}

export interface KnowledgeBase {
  activities: Activity[];
  artifact_lifecycles: ArtifactLifecycleDefinition[];
  artifacts: Artifact[];
  authored_activity_synonyms: AuthoredActivitySynonym[];
  people: Person[];
  policies: Policy[];
  projects: Project[];
  role_repertoires: RoleRepertoire[];
  roles: Role[];
  workflow_activities: WorkflowActivity[];
  workflows: Workflow[];
}

export interface AuthoredActivitySynonym {
  activity_id: ActivityId;
  synonym: string;
}

export interface ProcessSession extends ScopedRef {
  ended_ts: ISODateTime | null;
  extra: string[];
  fitness: number | null;
  id: ProcessSessionId;
  missing: string[];
  project_id: ProjectId;
  scenario_id?: string;
  source: SessionSource;
  started_ts: ISODateTime;
  status: SessionStatus;
  suggested: boolean;
  variant?: string;
  violations: PolicyId[];
  workflow_id: WorkflowId | null;
}

export interface Message extends ScopedRef {
  author_label: string;
  author_person_id: PersonId | null;
  availability: EvidenceAvailability;
  deleted: boolean;
  id: MessageId;
  is_agent: boolean;
  permalink: string;
  received_at: ISODateTime;
  revision: number;
  session_id: ProcessSessionId;
  text: string;
  thread_ts: SlackTs | null;
  ts: SlackTs;
}

export interface EvidenceRef extends ScopedRef {
  message_id: MessageId;
  message_revision: number;
  span?: EvidenceSpan;
  ts: SlackTs;
}

export interface EvidenceSpan {
  end: number;
  start: number;
}

export interface Step {
  activity_id: ActivityId | null;
  actor_person_id: PersonId | null;
  artifact_id: ArtifactId | null;
  confidence: number;
  effort_days?: number;
  evidence: EvidenceRef[];
  handoff_to_person_id: PersonId | null;
  id: StepId;
  intent: string;
  lifecycle_state: LifecycleState;
  modality: Modality;
  negated: boolean;
  seq: number;
  session_id: ProcessSessionId;
  status: CurationStatus;
  ts_end: ISODateTime | null;
  ts_start: ISODateTime;
  type: StepType;
}

export interface PromiseReportReconciliation {
  report_step_id: StepId;
  resolution: "advanced" | "duplicate_dropped" | "unmatched";
  source_step_id: StepId;
}

export interface RoleDeviation {
  activity_id: ActivityId;
  evidence: EvidenceRef[];
  expected: RoleId;
  observed: RoleId;
  of: number;
  sessions: ProcessSessionId[];
}

export interface UnreconciledWork {
  actor_person_id: PersonId | null;
  evidence: EvidenceRef[];
  reason: "abandoned" | "case_closed" | "still_open";
  state: Exclude<LifecycleState, "done" | "skipped">;
  step_id: StepId;
}

export interface GraphNode {
  activity: Activity;
  id: ActivityId | StepId;
  role_deviations: RoleDeviation[];
  unreconciled: UnreconciledWork[];
}

export interface GraphEdge {
  cases: ProcessSessionId[];
  from: ActivityId | StepId;
  id: GraphEdgeId;
  is_back_edge: boolean;
  kind: FollowKind;
  label?: string;
  observed_support: number;
  plane: GraphPlane;
  probability: number | null;
  to: ActivityId | StepId;
  violates: PolicyId[];
  weight: number;
}

export interface GraphView {
  conformance: WorkflowConformance | null;
  edges: GraphEdge[];
  generated_at: ISODateTime;
  happy_path: GraphEdgeId[];
  key: string;
  kind: GraphViewKind;
  min_support: number;
  nodes: GraphNode[];
  project_id: ProjectId;
  revision: number;
  session_id?: ProcessSessionId;
  workflow_id?: WorkflowId;
}

export interface MissingActivity {
  of: number;
  seen_in_sessions: number;
  slug: string;
}

export interface ExtraActivity {
  occurrences: number;
  slug: string;
}

export interface OrderBreak {
  expected_between: string | null;
  from: string;
  to: string;
}

export interface PolicyViolation {
  evidence: EvidenceRef[];
  policy_id: PolicyId;
  quote: string;
  text: string;
}

export interface SessionConformance {
  extra: ExtraActivity[];
  fitness: number | null;
  missing: MissingActivity[];
  order_breaks: OrderBreak[];
  precision: number | null;
  role_deviations: RoleDeviation[];
  session_id: ProcessSessionId;
  unreconciled: UnreconciledWork[];
  violations: PolicyViolation[];
  workflow_id: WorkflowId;
}

export interface WorkflowConformance
  extends Omit<SessionConformance, "session_id"> {
  closed_sessions: number;
  open_sessions: number;
}

export interface GraphDelta {
  base_revision: number;
  conformance?: WorkflowConformance | null;
  edges_added: GraphEdge[];
  edges_removed: GraphEdgeId[];
  edges_updated: GraphEdge[];
  nodes_added: GraphNode[];
  nodes_removed: Array<ActivityId | StepId>;
  nodes_updated: GraphNode[];
  replace?: boolean;
  revision: number;
  view_key: string;
}

export type Citation =
  | CountCitation
  | EvidenceCitation
  | KbCitation
  | RecordCitation;

export interface EvidenceCitation {
  kind: "evidence";
  message_id: MessageId;
  permalink: string;
}

export interface KbCitation {
  id: ActivityId | ArtifactId | PersonId | PolicyId | ProjectId | WorkflowId;
  kind: "kb";
}

export interface CountCitation {
  count: number;
  id: string;
  kind: "count";
  metric: "occurrences" | "support" | "violations";
  of?: number;
}

export interface RecordCitation {
  id: GraphEdgeId | ProcessSessionId | StepId;
  kind: "record";
}

export interface RagAnswer {
  answer: string;
  citations: Citation[];
  subgraph: GraphView;
}

export interface Snapshot {
  conformance: SessionConformance[];
  cursor: JournalId;
  graph: GraphView;
  kb: KnowledgeBase;
  messages: Message[];
  sessions: ProcessSession[];
  steps: Step[];
}

export type Command =
  | ConfirmStepCommand
  | RebuildGraphCommand
  | RejectStepCommand;

export interface CommandBase extends ScopedRef {
  kind: CommandKind;
  request_id: string;
}




export interface ConfirmStepCommand extends CommandBase {
  kind: "confirm_step";
  step_id: StepId;
}

export interface RejectStepCommand extends CommandBase {
  kind: "reject_step";
  step_id: StepId;
}

export interface RebuildGraphCommand extends CommandBase {
  kind: "rebuild_graph";
  project_id: ProjectId;
  workflow_id?: WorkflowId;
}

export interface ApiError {
  error: {
    code: string;
    message: string;
  };
}

export interface JournalEnvelope<TPayload = unknown> extends ScopedRef {
  id: JournalId;
  kind: JournalEventKind;
  payload: TPayload;
  project_id: ProjectId;
  session_id?: ProcessSessionId;
  ts: ISODateTime;
}

export type JournalEvent =
  | JournalEnvelope<Message>
  | JournalEnvelope<GraphDelta>
  | JournalEnvelope<SessionConformance | WorkflowConformance>
  | JournalEnvelope<ProcessSession>
  | JournalEnvelope<Step>
  | JournalEnvelope<AgentPost>
  | JournalEnvelope<PauseResumePayload>
  | JournalEnvelope<SessionClosedPayload>
  | JournalEnvelope<ResetPayload>;

export interface AgentPost {
  kind: "answer" | "drift" | "playbook";
  session_id: ProcessSessionId;
  slack_ts: SlackTs;
  text: string;
}

export interface PauseResumePayload {
  by: PersonId | "system";
  reason?: string;
  session_id: ProcessSessionId;
}

export interface SessionClosedPayload {
  conformance: SessionConformance;
  session_id: ProcessSessionId;
}

export interface ResetPayload {
  reason: string;
}

export interface OutboxItem extends ScopedRef {
  attempts: number;
  kind: "slack_post" | "slack_reaction";
  next_due_ts: ISODateTime | null;
  operation_id: string;
  payload: unknown;
  slack_ts: SlackTs | null;
  status: OutboxStatus;
}

export interface ProcessingCheckpoint extends ScopedRef {
  checkpoint_id: string;
  error: string | null;
  extraction_window_revision: number;
  observation_id: string;
  retries: number;
  status: ProcessingStatus;
}

export interface IngestionPort {
  recordObservation: (input: RawObservation) => Promise<IngestionResult>;
}

export interface RawObservation extends ScopedRef {
  event_id: string;
  payload: unknown;
  received_at: ISODateTime;
  signature_verified: boolean;
}

export interface IngestionResult {
  accepted: boolean;
  duplicate: boolean;
  message?: Message;
  operation_id: string;
}

export interface ExtractionPort {
  extract: (
    window: readonly Message[],
    priorSteps: readonly Step[],
    context: ExtractionContext
  ) => Promise<ExtractionResult>;
}

export interface ExtractionContext {
  activities: readonly Activity[];
  artifacts: readonly Artifact[];
  people: readonly Person[];
  project_id: ProjectId;
  role_repertoires: readonly RoleRepertoire[];
}

export interface ExtractionResult {
  reconciliation: PromiseReportReconciliation[];
  steps: Step[];
  warnings: string[];
}

export interface GraphPort {
  rebuild: (input: GraphRebuildInput) => Promise<GraphRebuildResult>;
}

export interface GraphRebuildInput {
  graph: GraphView | null;
  kb: KnowledgeBase;
  messages: readonly Message[];
  sessions: readonly ProcessSession[];
  steps: readonly Step[];
  view: GraphViewKind;
}

export interface GraphRebuildResult {
  delta: GraphDelta;
  graph: GraphView;
  journal: JournalEnvelope<GraphDelta>;
}

export interface ObserverPort {
  evaluate: (input: ObserverInput) => Promise<ObserverDecision[]>;
}

export interface ObserverInput {
  conformance: SessionConformance | WorkflowConformance;
  graph: GraphView;
  latest_event: JournalEvent;
  snapshot: Snapshot;
}

export type ObserverDecision =
  | {
      kind: "post";
      outbox: OutboxItem;
    }
  | {
      command: RebuildGraphCommand;
      kind: "rebuild";
    };
