import type { LucideIcon } from "lucide-react";
import {
  AlertTriangle,
  ArrowDown,
  ArrowUp,
  Check,
  CheckCircle2,
  Circle,
  History,
  LoaderCircle,
  MessageSquare,
  PlugZap,
  Plus,
  RefreshCw,
  Trash2,
  Unplug,
  UserCog,
  Workflow,
} from "lucide-react";
import type { ReactNode, SubmitEvent } from "react";
import { useCallback, useEffect, useRef, useState } from "react";

interface SetupChannel {
  backfilled_at: string | null;
  enabled: boolean;
  id: string;
  last_error: string | null;
  name: string;
  project_id: string | null;
  session_idle_seconds: number;
}

interface SetupInstall {
  bot_user_id: string;
  installed_at: string;
  missing_scopes: string[];
  scopes: string[];
  team_domain: string | null;
  team_name: string;
  workspace_id: string;
}

interface SetupPerson {
  id: string;
  is_bot: boolean;
  name: string;
  role_id: string | null;
  slack_user_id: string;
  title: string;
}

interface SetupProject {
  id: string;
  name: string;
  summary: string;
  workflow_id: string | null;
}

interface SetupRole {
  id: string;
  name: string;
}

interface SetupWorkflowActivity {
  label: string;
  role: string;
  slug: string;
  synonyms: string[];
}

interface SetupWorkflow {
  activities: SetupWorkflowActivity[];
  entry_activity: string;
  exit_activities: string[];
  id: string;
  name: string;
  project_id: string;
}

export interface SetupStatus {
  channels: SetupChannel[];
  extraction: { configured: boolean };
  install: SetupInstall | null;
  people: SetupPerson[];
  projects: SetupProject[];
  ready: boolean;
  roles: SetupRole[];
  signing_secret_configured: boolean;
  workflows: SetupWorkflow[];
}

interface SetupErrorPayload {
  error: {
    code: string;
    details?: Array<{ field: string; message: string }>;
    message: string;
  };
}

interface WorkflowActivityInput {
  label: string;
  role: string | null;
}

interface ChannelUpdateBody {
  enabled: boolean;
  project_id: string | null;
  session_idle_seconds?: number;
}

interface BackfillResult {
  ingested: number;
  skipped: number;
  threads: number;
}

interface SetupViewProps {
  onReady?: () => void;
}

export default function SetupView({ onReady }: SetupViewProps) {
  const [status, setStatus] = useState<SetupStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const previousReadyRef = useRef<boolean | undefined>(undefined);

  const load = useCallback(async () => {
    try {
      const payload = await fetchJson<SetupStatus>("/api/setup/status");
      setStatus(payload);
      setLoadError("");
    } catch (caught) {
      setLoadError(errorMessage(caught));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    const current = status?.ready;
    if (current === undefined) {
      return;
    }
    const previous = previousReadyRef.current;
    previousReadyRef.current = current;
    if (previous === false && current) {
      onReady?.();
    }
  }, [onReady, status?.ready]);

  const connectSlack = useCallback(async () => {
    const { authorize_url } = await fetchJson<{ authorize_url: string }>(
      "/api/setup/slack/install"
    );
    window.location.assign(authorize_url);
  }, []);

  const disconnectSlack = useCallback(async () => {
    await deleteJson("/api/setup/slack/install");
    await load();
  }, [load]);

  const syncChannels = useCallback(async () => {
    const result = await postJson<{ channels: number }>(
      "/api/setup/slack/channels/sync",
      {}
    );
    await load();
    return result.channels;
  }, [load]);

  const createProject = useCallback(
    async (name: string, summary: string) => {
      const body = summary ? { name, summary } : { name };
      const result = await postJson<{ project: SetupProject }>(
        "/api/setup/projects",
        body
      );
      await load();
      return result.project;
    },
    [load]
  );

  const createWorkflow = useCallback(
    async (
      projectId: string,
      name: string,
      activities: WorkflowActivityInput[]
    ) => {
      await postJson("/api/setup/workflows", {
        activities,
        name,
        project_id: projectId,
      });
      await load();
    },
    [load]
  );

  const updateChannel = useCallback(
    async (id: string, body: ChannelUpdateBody) => {
      await postJson(`/api/setup/channels/${encodeURIComponent(id)}`, body);
      await load();
    },
    [load]
  );

  const backfillChannel = useCallback(
    async (id: string) => {
      const result = await postJson<BackfillResult>(
        `/api/setup/channels/${encodeURIComponent(id)}/backfill`,
        {}
      );
      await load();
      return result;
    },
    [load]
  );

  const assignRole = useCallback(
    async (personId: string, roleId: string | null) => {
      await postJson(`/api/setup/people/${encodeURIComponent(personId)}/role`, {
        role_id: roleId,
      });
      await load();
    },
    [load]
  );

  if (loading && !status) {
    return (
      <div className="setup-view">
        <div className="loading-state">
          <LoaderCircle className="spin" />
          <p>Loading setup status…</p>
        </div>
      </div>
    );
  }

  if (loadError && !status) {
    return (
      <div className="setup-view">
        <div className="banner error" role="alert">
          {loadError}
          <button onClick={() => load()} type="button">
            Retry
          </button>
        </div>
      </div>
    );
  }

  if (!status) {
    return null;
  }

  const nonBotPeople = status.people.filter((person) => !person.is_bot);
  const rolesDone =
    nonBotPeople.length > 0 &&
    nonBotPeople.every((person) => Boolean(person.role_id));
  const channelDone = status.channels.some(
    (channel) => channel.enabled && Boolean(channel.project_id)
  );
  const workflowDone = status.workflows.length > 0;

  return (
    <div className="setup-view">
      <div className="eyebrow">
        <span />
        ONBOARDING
      </div>
      <h1>Set up AriadneOS</h1>
      <p>
        Connect Slack, define a workflow, and enable a channel so AriadneOS can
        mine the process people actually follow.
      </p>
      <div aria-live="polite" className="setup-notices">
        {status.extraction.configured ? null : (
          <div className="banner error" role="alert">
            <AlertTriangle size={16} />
            OPENROUTER_API_KEY is not set on the Worker. No steps will be
            extracted from Slack messages until it is configured.
          </div>
        )}
        {status.signing_secret_configured ? null : (
          <div className="banner error" role="alert">
            <AlertTriangle size={16} />
            SLACK_SIGNING_SECRET is not set on the Worker. Slack events will not
            be delivered until it is configured.
          </div>
        )}
        {loadError ? (
          <div className="banner error" role="alert">
            {loadError}
            <button onClick={() => load()} type="button">
              Retry
            </button>
          </div>
        ) : null}
        {status.ready ? (
          <div className="banner success" role="status">
            <Check size={16} />
            Setup is complete. AriadneOS is mining this channel.
          </div>
        ) : null}
      </div>
      <div className="setup-steps">
        <ConnectSlackStep
          install={status.install}
          onConnect={connectSlack}
          onDisconnect={disconnectSlack}
        />
        <ProjectWorkflowStep
          done={workflowDone}
          onCreateProject={createProject}
          onCreateWorkflow={createWorkflow}
          projects={status.projects}
          roles={status.roles}
          workflows={status.workflows}
        />
        <ChannelStep
          channels={status.channels}
          done={channelDone}
          hasInstall={Boolean(status.install)}
          onBackfillChannel={backfillChannel}
          onSyncChannels={syncChannels}
          onUpdateChannel={updateChannel}
          projects={status.projects}
        />
        <RolesStep
          done={rolesDone}
          onAssignRole={assignRole}
          people={status.people}
          roles={status.roles}
        />
      </div>
    </div>
  );
}

interface StepHeaderProps {
  done: boolean;
  icon: LucideIcon;
  index: number;
  title: string;
}

function StepHeader({ done, icon: Icon, index, title }: StepHeaderProps) {
  return (
    <div className="settings-heading">
      <div>
        <div className="section-kicker">STEP {index}</div>
        <h2>
          <Icon size={16} />
          {title}
        </h2>
      </div>
      <span className={done ? "settings-health" : "settings-health staging"}>
        {done ? <CheckCircle2 size={14} /> : <Circle size={14} />}
        {done ? "Done" : "To do"}
      </span>
    </div>
  );
}

interface ConnectSlackStepProps {
  install: SetupInstall | null;
  onConnect: () => Promise<void>;
  onDisconnect: () => Promise<void>;
}

function ConnectSlackStep({
  install,
  onConnect,
  onDisconnect,
}: ConnectSlackStepProps) {
  const [connecting, setConnecting] = useState(false);
  const [disconnecting, setDisconnecting] = useState(false);
  const [error, setError] = useState("");

  const connect = async () => {
    setConnecting(true);
    setError("");
    try {
      await onConnect();
    } catch (caught) {
      setError(errorMessage(caught));
      setConnecting(false);
    }
  };

  const disconnect = async () => {
    setDisconnecting(true);
    setError("");
    try {
      await onDisconnect();
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setDisconnecting(false);
    }
  };

  return (
    <section className="settings-panel setup-step">
      <StepHeader
        done={Boolean(install)}
        icon={PlugZap}
        index={1}
        title="Connect Slack"
      />
      {install ? (
        <>
          <div className="settings-grid">
            <article>
              <span>Workspace</span>
              <strong>{install.team_name}</strong>
              <small>{install.team_domain ?? install.workspace_id}</small>
            </article>
            <article>
              <span>Bot user</span>
              <strong>{install.bot_user_id}</strong>
              <small>Installed {formatDate(install.installed_at)}</small>
            </article>
            <article>
              <span>Scopes granted</span>
              <strong>{install.scopes.length}</strong>
              <small>{install.scopes.join(", ") || "None"}</small>
            </article>
          </div>
          {install.missing_scopes.length > 0 ? (
            <div className="settings-warning" role="alert">
              <AlertTriangle size={16} />
              Missing scopes: {install.missing_scopes.join(", ")}. Reinstall the
              Slack app to grant them.
            </div>
          ) : null}
          <div className="settings-actions">
            <button
              className="button secondary"
              disabled={connecting}
              onClick={connect}
              type="button"
            >
              {connecting ? (
                <LoaderCircle className="spin" size={14} />
              ) : (
                <PlugZap size={14} />
              )}
              Reinstall Slack app
            </button>
            <button
              className="button secondary"
              disabled={disconnecting}
              onClick={disconnect}
              type="button"
            >
              {disconnecting ? (
                <LoaderCircle className="spin" size={14} />
              ) : (
                <Unplug size={14} />
              )}
              Disconnect
            </button>
          </div>
        </>
      ) : (
        <>
          <p className="empty">
            Connect a Slack workspace to start observing channels.
          </p>
          <div className="settings-actions">
            <button
              className="button primary"
              disabled={connecting}
              onClick={connect}
              type="button"
            >
              {connecting ? (
                <LoaderCircle className="spin" size={14} />
              ) : (
                <PlugZap size={14} />
              )}
              Connect Slack
            </button>
          </div>
        </>
      )}
      {error ? <p role="alert">{error}</p> : null}
    </section>
  );
}

interface NewProjectFormProps {
  onCreate: (name: string, summary: string) => Promise<SetupProject>;
  onCreated: (projectId: string) => void;
}

function NewProjectForm({ onCreate, onCreated }: NewProjectFormProps) {
  const [name, setName] = useState("");
  const [summary, setSummary] = useState("");
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState("");

  const submit = async (event: SubmitEvent<HTMLFormElement>) => {
    event.preventDefault();
    const trimmedName = name.trim();
    if (!trimmedName) {
      setError("Project name is required.");
      return;
    }
    setCreating(true);
    setError("");
    try {
      const project = await onCreate(trimmedName, summary.trim());
      setName("");
      setSummary("");
      onCreated(project.id);
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setCreating(false);
    }
  };

  return (
    <form className="setup-form" onSubmit={submit}>
      <div className="setup-field">
        <label htmlFor="setup-new-project-name">New project name</label>
        <input
          disabled={creating}
          id="setup-new-project-name"
          onChange={(event) => setName(event.target.value)}
          value={name}
        />
      </div>
      <div className="setup-field">
        <label htmlFor="setup-new-project-summary">Summary (optional)</label>
        <input
          disabled={creating}
          id="setup-new-project-summary"
          onChange={(event) => setSummary(event.target.value)}
          value={summary}
        />
      </div>
      <button className="button secondary" disabled={creating} type="submit">
        {creating ? (
          <LoaderCircle className="spin" size={14} />
        ) : (
          <Plus size={14} />
        )}
        Create project
      </button>
      {error ? <p role="alert">{error}</p> : null}
    </form>
  );
}

function WorkflowSummary({ workflow }: { workflow: SetupWorkflow }) {
  return (
    <div>
      <p>
        <strong>{workflow.name}</strong> is defined with{" "}
        {workflow.activities.length} activit
        {workflow.activities.length === 1 ? "y" : "ies"}.
      </p>
      <ol>
        {workflow.activities.map((activity) => (
          <li key={activity.slug}>
            {activity.label}
            {activity.role ? ` · ${activity.role}` : ""}
          </li>
        ))}
      </ol>
    </div>
  );
}

interface DraftActivity {
  key: string;
  label: string;
  role: string;
}

function createDraftActivity(key: string): DraftActivity {
  return { key, label: "", role: "" };
}

function moveDraftActivity(
  activities: DraftActivity[],
  index: number,
  offset: -1 | 1
): DraftActivity[] {
  const target = index + offset;
  if (target < 0 || target >= activities.length) {
    return activities;
  }
  const next = [...activities];
  const [moved] = next.splice(index, 1);
  if (!moved) {
    return activities;
  }
  next.splice(target, 0, moved);
  return next;
}

interface WorkflowBuilderProps {
  onCreate: (
    projectId: string,
    name: string,
    activities: WorkflowActivityInput[]
  ) => Promise<void>;
  projectId: string;
  roles: SetupRole[];
}

function WorkflowBuilder({ onCreate, projectId, roles }: WorkflowBuilderProps) {
  const [name, setName] = useState("");
  const [activities, setActivities] = useState<DraftActivity[]>(() => [
    createDraftActivity("activity-0"),
  ]);
  const nextKeyRef = useRef(1);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  const addActivity = () => {
    const key = `activity-${nextKeyRef.current}`;
    nextKeyRef.current += 1;
    setActivities((current) => [...current, createDraftActivity(key)]);
  };

  const removeActivity = (key: string) => {
    setActivities((current) =>
      current.filter((activity) => activity.key !== key)
    );
  };

  const updateActivity = (
    key: string,
    patch: Partial<Pick<DraftActivity, "label" | "role">>
  ) => {
    setActivities((current) =>
      current.map((activity) =>
        activity.key === key ? { ...activity, ...patch } : activity
      )
    );
  };

  const moveActivity = (index: number, offset: -1 | 1) => {
    setActivities((current) => moveDraftActivity(current, index, offset));
  };

  const submit = async (event: SubmitEvent<HTMLFormElement>) => {
    event.preventDefault();
    const trimmedName = name.trim();
    const validActivities = activities
      .map((activity) => ({
        label: activity.label.trim(),
        role: activity.role.trim() || null,
      }))
      .filter((activity) => activity.label.length > 0);
    if (!trimmedName || validActivities.length === 0) {
      setError("Add a workflow name and at least one activity label.");
      return;
    }
    setSubmitting(true);
    setError("");
    try {
      await onCreate(projectId, trimmedName, validActivities);
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <form className="setup-form" onSubmit={submit}>
      <div className="setup-field">
        <label htmlFor="setup-workflow-name">Workflow name</label>
        <input
          disabled={submitting}
          id="setup-workflow-name"
          onChange={(event) => setName(event.target.value)}
          value={name}
        />
      </div>
      <div className="curation-list">
        {activities.map((activity, index) => (
          <div className="curation-item" key={activity.key}>
            <div>
              <div className="setup-field">
                <label htmlFor={`setup-activity-label-${activity.key}`}>
                  Activity label
                </label>
                <input
                  id={`setup-activity-label-${activity.key}`}
                  onChange={(event) =>
                    updateActivity(activity.key, {
                      label: event.target.value,
                    })
                  }
                  value={activity.label}
                />
              </div>
              <div className="setup-field">
                <label htmlFor={`setup-activity-role-${activity.key}`}>
                  Role (optional)
                </label>
                <select
                  id={`setup-activity-role-${activity.key}`}
                  onChange={(event) =>
                    updateActivity(activity.key, { role: event.target.value })
                  }
                  value={activity.role}
                >
                  <option value="">No role</option>
                  {roles.map((role) => (
                    <option key={role.id} value={role.name}>
                      {role.name}
                    </option>
                  ))}
                </select>
              </div>
            </div>
            <div className="curation-actions">
              <button
                aria-label="Move activity up"
                disabled={index === 0}
                onClick={() => moveActivity(index, -1)}
                type="button"
              >
                <ArrowUp size={13} />
              </button>
              <button
                aria-label="Move activity down"
                disabled={index === activities.length - 1}
                onClick={() => moveActivity(index, 1)}
                type="button"
              >
                <ArrowDown size={13} />
              </button>
              <button
                aria-label="Remove activity"
                onClick={() => removeActivity(activity.key)}
                type="button"
              >
                <Trash2 size={13} />
              </button>
            </div>
          </div>
        ))}
      </div>
      <div className="settings-actions">
        <button
          className="button secondary"
          onClick={addActivity}
          type="button"
        >
          <Plus size={14} />
          Add activity
        </button>
        <button className="button primary" disabled={submitting} type="submit">
          {submitting ? (
            <LoaderCircle className="spin" size={14} />
          ) : (
            <Check size={14} />
          )}
          Create workflow
        </button>
      </div>
      {error ? <p role="alert">{error}</p> : null}
    </form>
  );
}

interface ProjectWorkflowStepProps {
  done: boolean;
  onCreateProject: (name: string, summary: string) => Promise<SetupProject>;
  onCreateWorkflow: (
    projectId: string,
    name: string,
    activities: WorkflowActivityInput[]
  ) => Promise<void>;
  projects: SetupProject[];
  roles: SetupRole[];
  workflows: SetupWorkflow[];
}

function ProjectWorkflowStep({
  done,
  onCreateProject,
  onCreateWorkflow,
  projects,
  roles,
  workflows,
}: ProjectWorkflowStepProps) {
  const [selectedProjectId, setSelectedProjectId] = useState(() => {
    const [firstProject] = projects;
    return firstProject?.id ?? "";
  });
  const selectedWorkflow =
    workflows.find((workflow) => workflow.project_id === selectedProjectId) ??
    null;

  let workflowSection: ReactNode = null;
  if (selectedWorkflow) {
    workflowSection = <WorkflowSummary workflow={selectedWorkflow} />;
  } else if (selectedProjectId) {
    workflowSection = (
      <WorkflowBuilder
        onCreate={onCreateWorkflow}
        projectId={selectedProjectId}
        roles={roles}
      />
    );
  }

  return (
    <section className="settings-panel setup-step">
      <StepHeader
        done={done}
        icon={Workflow}
        index={2}
        title="Project & workflow"
      />
      <p>
        Pick the project this channel belongs to, then describe its workflow as
        an ordered list of activities.
      </p>
      {projects.length === 0 ? (
        <p className="empty">No projects yet. Create one below.</p>
      ) : (
        <div className="setup-field">
          <label htmlFor="setup-project-select">Project</label>
          <select
            id="setup-project-select"
            onChange={(event) => setSelectedProjectId(event.target.value)}
            value={selectedProjectId}
          >
            {projects.map((project) => (
              <option key={project.id} value={project.id}>
                {project.name}
              </option>
            ))}
          </select>
        </div>
      )}
      <NewProjectForm
        onCreate={onCreateProject}
        onCreated={setSelectedProjectId}
      />
      {workflowSection}
    </section>
  );
}

function channelStatusLabel(channel: SetupChannel): string {
  if (channel.last_error) {
    return `Error: ${channel.last_error}`;
  }
  if (channel.backfilled_at) {
    return `Backfilled ${formatDate(channel.backfilled_at)}`;
  }
  return "Not backfilled yet";
}

interface ChannelRowProps {
  channel: SetupChannel;
  onBackfill: (id: string) => Promise<BackfillResult>;
  onUpdate: (id: string, body: ChannelUpdateBody) => Promise<void>;
  projects: SetupProject[];
}

function ChannelRow({
  channel,
  onBackfill,
  onUpdate,
  projects,
}: ChannelRowProps) {
  const [pending, setPending] = useState(false);
  const [backfilling, setBackfilling] = useState(false);
  const [error, setError] = useState("");
  const [importResult, setImportResult] = useState("");

  const updateEnabled = async (enabled: boolean) => {
    setPending(true);
    setError("");
    try {
      await onUpdate(channel.id, {
        enabled,
        project_id: channel.project_id,
      });
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setPending(false);
    }
  };

  const updateProject = async (projectId: string) => {
    setPending(true);
    setError("");
    try {
      await onUpdate(channel.id, {
        enabled: channel.enabled,
        project_id: projectId || null,
      });
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setPending(false);
    }
  };

  const runBackfill = async () => {
    setBackfilling(true);
    setError("");
    setImportResult("");
    try {
      const result = await onBackfill(channel.id);
      const threadWord = result.threads === 1 ? "thread" : "threads";
      setImportResult(
        `Imported ${result.ingested} messages across ${result.threads} ${threadWord} (${result.skipped} skipped).`
      );
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setBackfilling(false);
    }
  };

  return (
    <div className="curation-item">
      <div>
        <strong>#{channel.name}</strong>
        <span>{channelStatusLabel(channel)}</span>
        <div className="setup-field">
          <label htmlFor={`setup-channel-enabled-${channel.id}`}>Enabled</label>
          <input
            checked={channel.enabled}
            disabled={pending}
            id={`setup-channel-enabled-${channel.id}`}
            onChange={(event) => updateEnabled(event.target.checked)}
            type="checkbox"
          />
        </div>
        <div className="setup-field">
          <label htmlFor={`setup-channel-project-${channel.id}`}>Project</label>
          <select
            disabled={pending}
            id={`setup-channel-project-${channel.id}`}
            onChange={(event) => updateProject(event.target.value)}
            value={channel.project_id ?? ""}
          >
            <option value="">Unassigned</option>
            {projects.map((project) => (
              <option key={project.id} value={project.id}>
                {project.name}
              </option>
            ))}
          </select>
        </div>
        {channel.enabled ? (
          <button
            className="text-link"
            disabled={backfilling}
            onClick={runBackfill}
            type="button"
          >
            {backfilling ? (
              <LoaderCircle className="spin" size={13} />
            ) : (
              <History size={13} />
            )}
            Import recent history
          </button>
        ) : null}
        {importResult ? <p role="status">{importResult}</p> : null}
        {error ? <p role="alert">{error}</p> : null}
      </div>
    </div>
  );
}

interface ChannelStepProps {
  channels: SetupChannel[];
  done: boolean;
  hasInstall: boolean;
  onBackfillChannel: (id: string) => Promise<BackfillResult>;
  onSyncChannels: () => Promise<number>;
  onUpdateChannel: (id: string, body: ChannelUpdateBody) => Promise<void>;
  projects: SetupProject[];
}

function ChannelStep({
  channels,
  done,
  hasInstall,
  onBackfillChannel,
  onSyncChannels,
  onUpdateChannel,
  projects,
}: ChannelStepProps) {
  const [syncing, setSyncing] = useState(false);
  const [syncError, setSyncError] = useState("");
  const [syncMessage, setSyncMessage] = useState("");

  const sync = async () => {
    setSyncing(true);
    setSyncError("");
    setSyncMessage("");
    try {
      const count = await onSyncChannels();
      const channelWord = count === 1 ? "channel" : "channels";
      setSyncMessage(`Synced ${count} ${channelWord} from Slack.`);
    } catch (caught) {
      setSyncError(errorMessage(caught));
    } finally {
      setSyncing(false);
    }
  };

  return (
    <section className="settings-panel setup-step">
      <StepHeader
        done={done}
        icon={MessageSquare}
        index={3}
        title="Enable a channel"
      />
      <p>
        Turn on a Slack channel and bind it to a project so AriadneOS can mine
        it for process.
      </p>
      {hasInstall ? (
        <div className="settings-actions">
          <button
            className="button secondary"
            disabled={syncing}
            onClick={sync}
            type="button"
          >
            {syncing ? (
              <LoaderCircle className="spin" size={14} />
            ) : (
              <RefreshCw size={14} />
            )}
            Sync channels from Slack
          </button>
        </div>
      ) : null}
      {syncError ? <p role="alert">{syncError}</p> : null}
      {syncMessage ? <p role="status">{syncMessage}</p> : null}
      {hasInstall ? null : (
        <p className="empty">Connect Slack above before enabling a channel.</p>
      )}
      {hasInstall && channels.length === 0 ? (
        <p className="empty">
          No channels synced yet. Use "Sync channels from Slack" to list them.
        </p>
      ) : null}
      {channels.length > 0 ? (
        <div className="curation-list">
          {channels.map((channel) => (
            <ChannelRow
              channel={channel}
              key={channel.id}
              onBackfill={onBackfillChannel}
              onUpdate={onUpdateChannel}
              projects={projects}
            />
          ))}
        </div>
      ) : null}
    </section>
  );
}

interface PersonRowProps {
  onAssign: (personId: string, roleId: string | null) => Promise<void>;
  person: SetupPerson;
  roles: SetupRole[];
}

function PersonRow({ onAssign, person, roles }: PersonRowProps) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");

  const assign = async (roleId: string) => {
    setPending(true);
    setError("");
    try {
      await onAssign(person.id, roleId || null);
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setPending(false);
    }
  };

  return (
    <div className="curation-item">
      <div>
        <strong>{person.name}</strong>
        <span>{person.title || "No title on file"}</span>
        <div className="setup-field">
          <label htmlFor={`setup-role-${person.id}`}>Role</label>
          <select
            disabled={pending}
            id={`setup-role-${person.id}`}
            onChange={(event) => assign(event.target.value)}
            value={person.role_id ?? ""}
          >
            <option value="">No role assigned</option>
            {roles.map((role) => (
              <option key={role.id} value={role.id}>
                {role.name}
              </option>
            ))}
          </select>
        </div>
        {error ? <p role="alert">{error}</p> : null}
      </div>
    </div>
  );
}

interface RolesStepProps {
  done: boolean;
  onAssignRole: (personId: string, roleId: string | null) => Promise<void>;
  people: SetupPerson[];
  roles: SetupRole[];
}

function RolesStep({ done, onAssignRole, people, roles }: RolesStepProps) {
  const assignable = people.filter((person) => !person.is_bot);
  return (
    <section className="settings-panel setup-step">
      <StepHeader done={done} icon={UserCog} index={4} title="Assign roles" />
      <p>
        Map each person Slack resolved to a role so process steps can be
        attributed correctly.
      </p>
      {assignable.length === 0 ? (
        <p className="empty">
          No people discovered yet. They will appear once Slack activity is
          observed.
        </p>
      ) : (
        <div className="curation-list">
          {assignable.map((person) => (
            <PersonRow
              key={person.id}
              onAssign={onAssignRole}
              person={person}
              roles={roles}
            />
          ))}
        </div>
      )}
    </section>
  );
}

function errorMessage(caught: unknown): string {
  return caught instanceof Error ? caught.message : "Something went wrong.";
}

function isSetupErrorPayload(value: unknown): value is SetupErrorPayload {
  return (
    typeof value === "object" &&
    value !== null &&
    "error" in value &&
    typeof (value as { error?: { message?: unknown } }).error?.message ===
      "string"
  );
}

async function fetchJson<T = unknown>(
  input: string,
  init?: RequestInit
): Promise<T> {
  const response = await fetch(input, init);
  const payload: unknown = await response.json();
  if (!response.ok) {
    throw new Error(
      isSetupErrorPayload(payload)
        ? payload.error.message
        : "Unable to reach AriadneOS."
    );
  }
  return payload as T;
}

function postJson<T = unknown>(path: string, body: unknown): Promise<T> {
  return fetchJson<T>(path, {
    body: JSON.stringify(body),
    headers: { "Content-Type": "application/json" },
    method: "POST",
  });
}

function deleteJson<T = unknown>(path: string): Promise<T> {
  return fetchJson<T>(path, { method: "DELETE" });
}

function formatDate(value: string) {
  return new Date(value).toLocaleString(undefined, {
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    month: "short",
  });
}
