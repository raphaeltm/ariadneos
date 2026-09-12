import {
  Activity,
  ArrowDownToLine,
  ArrowUpRight,
  Check,
  Cloud,
  GitBranch,
  Layers3,
  LoaderCircle,
  Play,
  RefreshCw,
  Search,
  Send,
  ShieldCheck,
  SlidersHorizontal,
  Sparkles,
  X,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import type {
  Message,
  ProcessSession,
  ProjectId,
  StepId,
  WorkflowId,
} from "../shared/contracts.ts";
import {
  type ApiAdapter,
  type ConnectionScope,
  createProductionApiAdapter,
} from "./api.ts";
import { AccountMenu } from "./auth-gate.tsx";
import AppShell, {
  type AppShellView,
} from "./components/app-shell/app-shell.tsx";
import {
  buildContractInspectorDetails,
  type InspectorCurationItem,
} from "./components/inspector/inspector-data.ts";
import { ProcessInspector } from "./components/inspector/process-inspector.tsx";
import { WorkflowCanvas } from "./components/process-canvas/workflow-canvas.tsx";
import { createSseClient } from "./sse.ts";
import {
  type AppSelection,
  type AppState,
  applyJournalEvent,
  applySnapshot,
  beginSnapshotLoad,
  createInitialState,
  failSnapshotLoad,
  scopeKey,
  selectCurrentGraph,
  selectProject,
} from "./store.ts";

interface WorkspaceSettings {
  auth: {
    provider: string;
    status: "configured" | "missing";
  };
  channelCoordinator: "ready" | "unbound" | "unconfigured";
  deployment: {
    activeTarget: "local" | "production" | "staging";
    controls: {
      enabled: boolean;
      href?: string;
      id: "actions" | "export" | "refresh";
      label: string;
    }[];
    targets: {
      database: string;
      domain: string;
      environment: "production" | "staging";
      selected: boolean;
      worker: string;
    }[];
  };
  environment: "local" | "production" | "staging";
  generatedAt: string;
  releaseSha: string;
  slack: {
    channel: string | null;
    status: "scoped" | "unconfigured";
    workspaceId: string | null;
  };
}

interface AskAnswer {
  answer: string;
  evidence?: string[];
  mode?: "ai" | "summary";
  notice?: string;
}

const defaultScope: ConnectionScope = {
  channel: "",
  min_support: 1,
  project_id: "proj_helios",
  view: "overlay",
  workflow_id: "wf_p1_incident",
  workspace_id: "",
};

const projectFallbacks = [
  {
    id: "proj_helios" as ProjectId,
    label: "Helios Payments",
    workflowId: "wf_p1_incident" as WorkflowId,
  },
  {
    id: "proj_atlas" as ProjectId,
    label: "Atlas Self-Serve Billing",
    workflowId: "wf_feature_intake" as WorkflowId,
  },
];

const legacyAskWorkflow: Record<string, string> = {
  wf_feature_intake: "refund",
  wf_p1_incident: "vendor",
};

// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: The route component coordinates the app shell, snapshot/SSE lifecycle, simulator, curation and agent controls.
export default function App() {
  const adapter = useMemo(() => createProductionApiAdapter(), []);
  const [state, setState] = useState(() => createInitialState(defaultScope));
  const [settings, setSettings] = useState<WorkspaceSettings | null>(null);
  const [settingsLoading, setSettingsLoading] = useState(true);
  const [settingsError, setSettingsError] = useState("");
  const [settingsRefresh, setSettingsRefresh] = useState(0);
  const [reloadToken, setReloadToken] = useState(0);
  const [shellView, setShellView] = useState<AppShellView>("graph");
  const [notice, setNotice] = useState("");
  const [simulating, setSimulating] = useState(false);
  const [question, setQuestion] = useState("");
  const [asking, setAsking] = useState(false);
  const [answer, setAnswer] = useState<AskAnswer | null>(null);
  const stateRef = useRef(state);
  stateRef.current = state;
  const { scope: snapshotScope } = state;

  useEffect(() => {
    let active = true;
    setSettingsLoading(true);
    setSettingsError("");
    fetch(`/api/settings?refresh=${settingsRefresh}`)
      .then(async (response) => {
        const payload = (await response.json()) as
          | WorkspaceSettings
          | { error?: string };
        if (!response.ok) {
          throw new Error(
            "error" in payload && payload.error
              ? payload.error
              : "Unable to load settings."
          );
        }
        return payload as WorkspaceSettings;
      })
      .then((payload) => {
        if (!active) {
          return;
        }
        const scoped = {
          ...stateRef.current.scope,
          channel: payload.slack.channel ?? "",
          workspace_id: payload.slack.workspaceId ?? "",
        };
        setSettings(payload);
        setState((current) => ({
          ...current,
          scope: scoped,
          scopeKey: scopeKey(scoped),
        }));
      })
      .catch((caught) => {
        if (active) {
          setSettingsError((caught as Error).message);
        }
      })
      .finally(() => {
        if (active) {
          setSettingsLoading(false);
        }
      });
    return () => {
      active = false;
    };
  }, [settingsRefresh]);

  useEffect(() => {
    const scope = snapshotScope;
    if (!(scope.project_id && scope.workflow_id)) {
      return;
    }
    const controller = new AbortController();
    const requestId = `${reloadToken}:${crypto.randomUUID()}`;
    setState((current) => beginSnapshotLoad(current, scope, requestId));
    adapter
      .fetchSnapshot({ scope, signal: controller.signal })
      .then((snapshot) => {
        setState((current) =>
          applySnapshot(current, snapshot, scope, requestId)
        );
      })
      .catch((caught) => {
        if (!controller.signal.aborted) {
          setState((current) =>
            failSnapshotLoad(current, requestId, caught as Error)
          );
        }
      });
    return () => controller.abort();
  }, [adapter, snapshotScope, reloadToken]);

  const graph = selectCurrentGraph(state);

  useEffect(() => {
    if (!graph) {
      return;
    }
    const client = createSseClient({
      adapter,
      after: state.connection.lastEventId ?? undefined,
      document,
      onEvent: (event) => {
        setState((current) => {
          const result = applyJournalEvent(current, event);
          if (result.effect.kind === "snapshot_required") {
            setReloadToken((value) => value + 1);
          }
          return result.state;
        });
      },
      onSnapshotRequired: () => setReloadToken((value) => value + 1),
      scope: state.scope,
    });
    try {
      client.start();
    } catch {
      return;
    }
    return () => client.stop();
  }, [adapter, graph, state.connection.lastEventId, state.scope]);

  const projectOptions = useMemo(() => {
    const projects =
      state.kb?.projects.map((project) => ({
        id: project.id,
        label: project.name,
        workflowId: project.workflow_id,
      })) ?? projectFallbacks;
    return projects.map((project) => ({
      id: project.id,
      label: project.label,
      workflowId: project.workflowId,
    }));
  }, [state.kb]);
  const activeProject = projectOptions.find(
    (project) => project.id === state.scope.project_id
  );
  const sessions = useMemo(
    () =>
      Object.values(state.sessions)
        .filter((session) => session.project_id === state.scope.project_id)
        .sort((a, b) => b.started_ts.localeCompare(a.started_ts)),
    [state.scope.project_id, state.sessions]
  );
  const messages = useMemo(
    () =>
      Object.values(state.messages).sort((a, b) =>
        b.received_at.localeCompare(a.received_at)
      ),
    [state.messages]
  );
  const selectedSession = state.selection.case_id
    ? state.sessions[state.selection.case_id]
    : sessions[0];
  const inspectorDetails = useMemo(
    () =>
      buildContractInspectorDetails({
        conformance: Object.values(state.conformance),
        graph,
        kb: state.kb,
        messages: state.messages,
        selection: state.selection,
        sessions: state.sessions,
        steps: state.steps,
      }),
    [graph, state]
  );

  const chooseProject = (projectId: string) => {
    const project = projectOptions.find((item) => item.id === projectId);
    if (!project) {
      return;
    }
    setAnswer(null);
    setNotice("");
    setShellView("graph");
    setState((current) =>
      selectProject(current, project.id, project.workflowId)
    );
  };

  const select = (selection: AppSelection) => {
    setShellView("inspector");
    setState((current) => ({
      ...current,
      selection: {
        ...selection,
        workflow_id: selection.workflow_id ?? current.scope.workflow_id,
      },
    }));
  };

  const clearSelection = () => {
    setState((current) => ({
      ...current,
      selection: { workflow_id: current.scope.workflow_id },
    }));
  };

  const runSimulation = async () => {
    setSimulating(true);
    setNotice("");
    try {
      const scenario =
        state.scope.project_id === "proj_atlas"
          ? {
              id: "atlas_feature",
              variant: "v2_roadmap_bypass",
            }
          : {
              id: "helios_p1",
              variant: "v2_skip_review",
            };
      const result = await adapter.runSimulation({
        request_id: crypto.randomUUID(),
        scenario_id: scenario.id,
        scope: state.scope,
        variant: scenario.variant,
      });
      setNotice(`Demo simulation persisted as ${result.session_id}.`);
      setReloadToken((value) => value + 1);
    } catch (caught) {
      setNotice((caught as Error).message);
    } finally {
      setSimulating(false);
    }
  };

  const curate = async (
    item: InspectorCurationItem,
    status: "confirmed" | "rejected"
  ) => {
    await adapter.updateStepStatus({
      request_id: crypto.randomUUID(),
      scope: state.scope,
      status,
      step_id: item.id as StepId,
    });
    setNotice(
      `${status === "confirmed" ? "Accepted" : "Rejected"} ${item.label}.`
    );
    setReloadToken((value) => value + 1);
  };

  const ask = async (text = question) => {
    const prompt = text.trim();
    if (!prompt || asking) {
      return;
    }
    setQuestion(prompt);
    setAsking(true);
    setAnswer(null);
    try {
      const response = await fetch("/api/ask", {
        body: JSON.stringify({
          question: prompt,
          thread_id: `${state.scope.project_id.slice(5)}-app`,
          workflow:
            legacyAskWorkflow[state.scope.workflow_id ?? ""] ?? "vendor",
        }),
        headers: { "Content-Type": "application/json" },
        method: "POST",
      });
      const payload = (await response.json()) as AskAnswer | { error?: string };
      if (!response.ok) {
        throw new Error(
          "error" in payload && payload.error
            ? payload.error
            : "Unable to ask Ariadne."
        );
      }
      setAnswer(payload as AskAnswer);
    } catch (caught) {
      setAnswer({
        answer: (caught as Error).message,
        evidence: [],
        mode: "summary",
        notice: "Request failed.",
      });
    } finally {
      setAsking(false);
    }
  };

  const exportSnapshot = () => {
    const payload = {
      conformance: Object.values(state.conformance),
      graph,
      messages: Object.values(state.messages),
      sessions: Object.values(state.sessions),
      steps: Object.values(state.steps),
    };
    const url = URL.createObjectURL(
      new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" })
    );
    const link = document.createElement("a");
    link.href = url;
    link.download = `ariadneos-${state.scope.project_id}.json`;
    link.click();
    URL.revokeObjectURL(url);
  };

  return (
    <AppShell
      accountMenu={<AccountMenu />}
      activeProjectId={state.scope.project_id}
      activeView={shellView}
      activeWorkspaceId="configured"
      connectionLabel={connectionLabel(state, settings)}
      onAbout={() => setShellView("settings")}
      onNavigate={setShellView}
      onProjectChange={chooseProject}
      onWorkspaceChange={() => undefined}
      primaryAction={
        <button
          className="button topbar-action"
          disabled={simulating || state.loading.requestId !== null}
          onClick={runSimulation}
          type="button"
        >
          {simulating ? (
            <LoaderCircle className="spin" size={16} />
          ) : (
            <Play fill="currentColor" size={13} />
          )}
          Run
        </button>
      }
      projectOptions={projectOptions}
      sidebarAction={
        <div className="demo-note">
          <span className="demo-orbit">
            <Sparkles size={19} />
          </span>
          <strong>Real pipeline demo</strong>
          <p>Generate Slack-like work and persist it through D1.</p>
          <button
            disabled={simulating || state.loading.requestId !== null}
            onClick={runSimulation}
            type="button"
          >
            Run simulator <ArrowUpRight size={15} />
          </button>
        </div>
      }
      workspaceOptions={[
        {
          detail: settings?.slack.channel ?? "Configured server scope",
          id: "configured",
          label: settings?.slack.workspaceId ?? "Workspace",
        },
      ]}
    >
      <main>
        <div className="page-heading">
          <div>
            <div className="eyebrow">
              <span />
              LIVE PROCESS INTELLIGENCE
            </div>
            <h1>{activeProject?.label ?? "Process workspace"}</h1>
            <p>
              D1-backed graph, evidence, curation, conformance, and simulator
              data from the process API.
            </p>
          </div>
          <div className="heading-actions">
            <button
              className="button secondary"
              disabled={!graph}
              onClick={exportSnapshot}
              type="button"
            >
              <ArrowDownToLine size={16} />
              Export snapshot
            </button>
            <button
              className="button primary"
              disabled={simulating}
              onClick={runSimulation}
              type="button"
            >
              {simulating ? (
                <LoaderCircle className="spin" size={16} />
              ) : (
                <Play fill="currentColor" size={14} />
              )}
              {simulating ? "Running..." : "Run demo mode"}
            </button>
          </div>
        </div>
        {state.connection.error ? (
          <div className="banner error" role="alert">
            {state.connection.error}
            <button
              onClick={() => setReloadToken((value) => value + 1)}
              type="button"
            >
              Retry
            </button>
          </div>
        ) : null}
        {notice ? (
          <div className="banner success" role="status">
            <Check size={16} />
            {notice}
            <button
              aria-label="Dismiss notification"
              onClick={() => setNotice("")}
              type="button"
            >
              <X size={14} />
            </button>
          </div>
        ) : null}
        <LiveStats
          graph={graph}
          messages={messages}
          sessions={sessions}
          state={state}
        />
        {state.loading.requestId && !graph ? (
          <div className="loading-state">
            <LoaderCircle className="spin" />
            <p>Loading process snapshot...</p>
          </div>
        ) : null}
        {shellView === "settings" ? (
          <SettingsPanel
            adapter={adapter}
            graphReady={Boolean(graph)}
            onExport={exportSnapshot}
            onRefreshRuntime={() => setSettingsRefresh((value) => value + 1)}
            onReload={() => setReloadToken((value) => value + 1)}
            settings={settings}
            settingsError={settingsError}
            settingsLoading={settingsLoading}
            state={state}
          />
        ) : (
          <section className="explorer live-explorer">
            <div className="explorer-header">
              <div className="process-title">
                <span className="process-icon">
                  <GitBranch size={20} />
                </span>
                <div>
                  <h2>{graph?.workflow_id ?? state.scope.workflow_id}</h2>
                  <p>
                    {graph
                      ? `${graph.nodes.length} activities, ${graph.edges.length} transitions, revision ${graph.revision}`
                      : "Waiting for a process snapshot."}
                  </p>
                </div>
              </div>
              <span className="source-chip">
                <span className="online-dot" />
                {state.connection.status}
              </span>
            </div>
            <div className="explorer-body">
              <div className="main-panel">
                {shellView === "graph" ? (
                  <MapPanel
                    graph={graph}
                    onModeChange={(view) =>
                      setState((current) => {
                        const scope = { ...current.scope, view };
                        return {
                          ...current,
                          scope,
                          scopeKey: scopeKey(scope),
                        };
                      })
                    }
                    onReload={() => setReloadToken((value) => value + 1)}
                    onSelect={select}
                    selection={state.selection}
                  />
                ) : null}
                {shellView === "inspector" ? (
                  <div className="embedded-inspector">
                    <ProcessInspector
                      details={inspectorDetails}
                      onClearSelection={clearSelection}
                      onCuration={curate}
                      onInspectSources={() => setShellView("activity")}
                    />
                  </div>
                ) : null}
                {shellView === "activity" ? (
                  <ActivityPanel
                    messages={messages}
                    onSearchMessage={(message) =>
                      select({
                        case_id: message.session_id,
                        message_id: message.id,
                        workflow_id: state.scope.workflow_id,
                      })
                    }
                    selectedSession={selectedSession}
                    sessions={sessions}
                    setSelectedSession={(session) =>
                      setState((current) => ({
                        ...current,
                        selection: {
                          case_id: session?.id,
                          workflow_id: current.scope.workflow_id,
                        },
                      }))
                    }
                  />
                ) : null}
              </div>
              <ProcessInspector
                details={inspectorDetails}
                onClearSelection={clearSelection}
                onCuration={curate}
                onInspectSources={() => setShellView("activity")}
                onOpenContext={() => setShellView("activity")}
              />
            </div>
          </section>
        )}
        {shellView === "settings" ? null : (
          <div className="bottom-grid">
            <RecentEvidence messages={messages} onSelect={select} />
            <AssistantPanel
              answer={answer}
              ask={ask}
              asking={asking}
              question={question}
              setQuestion={setQuestion}
            />
          </div>
        )}
        <footer>
          <span>
            <span className="online-dot" />
            Snapshot cursor {state.connection.lastEventId ?? "n/a"}
          </span>
          <span>
            AriadneOS app <span>·</span> {sessions.length} D1 process sessions
          </span>
        </footer>
      </main>
    </AppShell>
  );
}

function MapPanel({
  graph,
  onModeChange,
  onReload,
  onSelect,
  selection,
}: {
  graph: ReturnType<typeof selectCurrentGraph>;
  onModeChange: (view: ConnectionScope["view"]) => void;
  onReload: () => void;
  onSelect: (selection: AppSelection) => void;
  selection: AppSelection;
}) {
  if (!graph) {
    return (
      <div className="loading-state">
        <p>No process graph is available for this scope yet.</p>
        <button className="button secondary" onClick={onReload} type="button">
          Reload snapshot
        </button>
      </div>
    );
  }
  return (
    <>
      <div className="graph-hint">
        <span className="tiny-dot" />
        Live overlay from /api/snapshot
        <span>Click a node or edge to inspect evidence and conformance.</span>
      </div>
      <WorkflowCanvas
        graph={graph}
        onModeChange={onModeChange}
        onSelectionChange={onSelect}
        selection={selection}
      />
    </>
  );
}

function LiveStats({
  graph,
  messages,
  sessions,
  state,
}: {
  graph: ReturnType<typeof selectCurrentGraph>;
  messages: Message[];
  sessions: ProcessSession[];
  state: AppState;
}) {
  const conformance = graph?.conformance;
  return (
    <div className="stats-row">
      <Stat
        icon={<Layers3 size={17} />}
        label="Graph activities"
        sub="Documented and discovered"
        value={String(graph?.nodes.length ?? 0)}
      />
      <Stat
        icon={<GitBranch size={17} />}
        label="Transitions"
        sub="Directly follows evidence"
        value={String(graph?.edges.length ?? 0)}
      />
      <Stat
        icon={<Activity size={17} />}
        label="Evidence messages"
        sub={`${sessions.length} process sessions`}
        value={String(messages.length)}
      />
      <Stat
        icon={<ShieldCheck size={17} />}
        label="Conformance"
        sub={state.connection.status}
        value={
          conformance?.fitness === null || conformance?.fitness === undefined
            ? "n/a"
            : `${Math.round(conformance.fitness * 100)}%`
        }
      />
    </div>
  );
}

function ActivityPanel({
  messages,
  onSearchMessage,
  selectedSession,
  sessions,
  setSelectedSession,
}: {
  messages: Message[];
  onSearchMessage: (message: Message) => void;
  selectedSession: ProcessSession | undefined;
  sessions: ProcessSession[];
  setSelectedSession: (session: ProcessSession | undefined) => void;
}) {
  const [search, setSearch] = useState("");
  const filtered = messages.filter((message) => {
    const matchesSession =
      !selectedSession || message.session_id === selectedSession.id;
    const haystack =
      `${message.author_label} ${message.text} ${message.session_id}`.toLowerCase();
    return matchesSession && haystack.includes(search.toLowerCase());
  });
  return (
    <div className="events-panel">
      <div className="event-controls">
        <label>
          <Search size={16} />
          <input
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search evidence, actors, cases..."
            value={search}
          />
        </label>
        <select
          aria-label="Filter case"
          onChange={(event) =>
            setSelectedSession(
              sessions.find((session) => session.id === event.target.value)
            )
          }
          value={selectedSession?.id ?? ""}
        >
          <option value="">All sessions</option>
          {sessions.map((session) => (
            <option key={session.id} value={session.id}>
              {session.id}
            </option>
          ))}
        </select>
      </div>
      <div className="event-summary">{filtered.length} evidence messages</div>
      <div className="event-list">
        {filtered.length ? (
          filtered.map((message) => (
            <div className="event-row" key={message.id}>
              <span className="avatar">{initials(message.author_label)}</span>
              <div className="event-description">
                <strong>{message.author_label}</strong>
                <span>{message.text}</span>
              </div>
              <button
                className="case-link"
                onClick={() => onSearchMessage(message)}
                type="button"
              >
                {message.session_id}
                <ArrowUpRight size={11} />
              </button>
              <time dateTime={message.received_at}>
                {formatTime(message.received_at)}
              </time>
            </div>
          ))
        ) : (
          <div className="empty">No evidence matches this filter.</div>
        )}
      </div>
    </div>
  );
}

function RecentEvidence({
  messages,
  onSelect,
}: {
  messages: Message[];
  onSelect: (selection: AppSelection) => void;
}) {
  return (
    <section className="recent-card">
      <div className="card-heading">
        <h2>
          <Activity size={17} />
          Recent evidence
        </h2>
      </div>
      <div className="event-list compact">
        {messages.slice(0, 4).map((message) => (
          <div className="event-row" key={message.id}>
            <span className="avatar tiny">
              {initials(message.author_label)}
            </span>
            <div className="event-description">
              <strong>{message.author_label}</strong>
              <span>{message.text}</span>
            </div>
            <button
              className="case-link"
              onClick={() =>
                onSelect({
                  case_id: message.session_id,
                  message_id: message.id,
                })
              }
              type="button"
            >
              Open
              <ArrowUpRight size={11} />
            </button>
          </div>
        ))}
        {messages.length ? null : (
          <div className="empty">Run demo mode to add D1-backed evidence.</div>
        )}
      </div>
    </section>
  );
}

function AssistantPanel({
  answer,
  ask,
  asking,
  question,
  setQuestion,
}: {
  answer: AskAnswer | null;
  ask: (text?: string) => Promise<void>;
  asking: boolean;
  question: string;
  setQuestion: (value: string) => void;
}) {
  return (
    <section className="assistant-card">
      <div className="assistant-heading">
        <span className="assistant-icon">
          <Sparkles size={19} />
        </span>
        <div>
          <h2>Ask Ariadne</h2>
          <p>
            Agent memory and OpenRouter fallback are routed through /api/ask.
          </p>
        </div>
        <span className="beta">AI</span>
      </div>
      {answer ? (
        <div aria-live="polite" className="answer">
          <span className="answer-label">
            {answer.mode === "ai" ? "ARIADNE · OPENROUTER" : "COMPUTED SUMMARY"}
          </span>
          {answer.notice ? <small>{answer.notice}</small> : null}
          <p>{answer.answer}</p>
        </div>
      ) : (
        <div className="suggestions">
          <button
            onClick={() => ask("What is the most common observed path?")}
            type="button"
          >
            What normally happens? <ArrowUpRight size={13} />
          </button>
          <button
            onClick={() => ask("Which observations show process drift?")}
            type="button"
          >
            Where is the drift? <ArrowUpRight size={13} />
          </button>
        </div>
      )}
      <form
        className="question-form"
        onSubmit={(event) => {
          event.preventDefault();
          ask();
        }}
      >
        <input
          aria-label="Ask a question about this process"
          disabled={asking}
          maxLength={400}
          onChange={(event) => setQuestion(event.target.value)}
          placeholder="What would you like to understand?"
          value={question}
        />
        <button
          aria-label="Send question"
          disabled={asking || !question.trim()}
          type="submit"
        >
          {asking ? (
            <LoaderCircle className="spin" size={17} />
          ) : (
            <Send size={17} />
          )}
        </button>
      </form>
    </section>
  );
}

function SettingsPanel({
  adapter,
  graphReady,
  onExport,
  onRefreshRuntime,
  onReload,
  settings,
  settingsError,
  settingsLoading,
  state,
}: {
  adapter: ApiAdapter;
  graphReady: boolean;
  onExport: () => void;
  onRefreshRuntime: () => void;
  onReload: () => void;
  settings: WorkspaceSettings | null;
  settingsError: string;
  settingsLoading: boolean;
  state: AppState;
}) {
  const deployWorkflow = settings?.deployment.controls.find(
    (control) => control.id === "actions"
  );
  return (
    <section className="settings-panel">
      <div className="settings-heading">
        <div>
          <div className="section-kicker">WORKSPACE SETTINGS</div>
          <h2>Workspace configuration</h2>
          <p>
            Scope, source, deployment target, and runtime controls for the
            current process explorer.
          </p>
        </div>
        <span className={`settings-health ${settings?.environment ?? "local"}`}>
          <span className="online-dot" />
          {settingsLoading
            ? "Checking runtime"
            : `Runtime ${settings?.environment ?? "local"}`}
        </span>
      </div>
      {settingsError ? (
        <div className="settings-warning" role="alert">
          <ShieldCheck size={16} />
          {settingsError}
        </div>
      ) : null}
      <div className="settings-grid">
        <article>
          <span>Workspace</span>
          <strong>{settings?.slack.workspaceId ?? "unconfigured"}</strong>
          <small>{settings?.slack.channel ?? "No channel scope"}</small>
        </article>
        <article>
          <span>Project</span>
          <strong>{state.scope.project_id}</strong>
          <small>{state.scope.workflow_id ?? "No workflow selected"}</small>
        </article>
        <article>
          <span>Data source</span>
          <strong>{graphReady ? "D1 process API" : "Waiting"}</strong>
          <small>{adapter.buildStreamUrl(state.scope)}</small>
        </article>
        <article>
          <span>Coordinator</span>
          <strong>{settings?.channelCoordinator ?? "checking"}</strong>
          <small>Durable Object stream and journal replay</small>
        </article>
        <article>
          <span>Release</span>
          <strong>{shortSha(settings?.releaseSha)}</strong>
          <small>
            {settings?.generatedAt
              ? `Observed ${formatTime(settings.generatedAt)}`
              : "Waiting for runtime settings"}
          </small>
        </article>
      </div>
      <div className="deployment-panel">
        <div className="deployment-heading">
          <span className="deployment-icon">
            <Cloud size={18} />
          </span>
          <div>
            <h3>Deployment configuration</h3>
            <p>
              GitHub Actions deploys staging and production to separate
              Cloudflare Workers and D1 databases.
            </p>
          </div>
        </div>
        <div className="deployment-targets">
          {(settings?.deployment.targets ?? []).map((target) => (
            <article
              className={target.selected ? "selected" : ""}
              key={target.environment}
            >
              <span>{target.environment}</span>
              <strong>{target.domain}</strong>
              <small>
                Worker {target.worker} · D1 {target.database}
              </small>
              {target.selected ? <em>Active runtime</em> : null}
            </article>
          ))}
        </div>
      </div>
      <div className="settings-actions">
        <button
          className="button secondary"
          disabled={settingsLoading}
          onClick={onRefreshRuntime}
          type="button"
        >
          {settingsLoading ? (
            <LoaderCircle className="spin" size={14} />
          ) : (
            <RefreshCw size={14} />
          )}
          Refresh runtime
        </button>
        <button className="button secondary" onClick={onReload} type="button">
          <SlidersHorizontal size={14} />
          Reload workspace
        </button>
        <button className="button secondary" onClick={onExport} type="button">
          <ArrowDownToLine size={14} />
          Export snapshot
        </button>
        <button
          className="button secondary"
          disabled={!deployWorkflow?.href}
          onClick={() => {
            if (deployWorkflow?.href) {
              window.open(deployWorkflow.href, "_blank", "noopener,noreferrer");
            }
          }}
          type="button"
        >
          Deploy workflow <ArrowUpRight size={14} />
        </button>
      </div>
    </section>
  );
}

function Stat({
  icon,
  label,
  sub,
  value,
}: {
  icon: React.ReactNode;
  label: string;
  sub: string;
  value: string;
}) {
  return (
    <div className="stat">
      <div className="stat-label">
        {label}
        {icon}
      </div>
      <div className="stat-value">{value}</div>
      <div className="stat-sub">{sub}</div>
    </div>
  );
}

function connectionLabel(state: AppState, settings: WorkspaceSettings | null) {
  if (settings?.slack.status === "unconfigured") {
    return "Channel unconfigured";
  }
  return `${state.connection.status} · ${settings?.environment ?? "local"}`;
}

function initials(name: string) {
  return name
    .split(" ")
    .map((part) => part[0])
    .join("")
    .slice(0, 2);
}

function formatTime(value: string) {
  return new Date(value).toLocaleString(undefined, {
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    month: "short",
  });
}

function shortSha(value: string | undefined) {
  if (!value || value === "local") {
    return "local";
  }
  return value.slice(0, 7);
}
