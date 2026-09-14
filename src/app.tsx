import {
  Activity,
  ArrowDownToLine,
  ArrowUpRight,
  Check,
  Cloud,
  GitBranch,
  Hash,
  Layers3,
  LoaderCircle,
  RefreshCw,
  Search,
  Send,
  ShieldCheck,
  SlidersHorizontal,
  Sparkles,
  X,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type {
  Message,
  ProcessSession,
  ProjectId,
  StepId,
} from "../shared/contracts.ts";
import {
  type ApiAdapter,
  type ConnectionScope,
  createProductionApiAdapter,
  type ModelEditAction,
} from "./api.ts";
import { AccountMenu } from "./auth-gate.tsx";
import { AgentChatPanel } from "./components/agent-chat/agent-chat-panel.tsx";
import AppShell, {
  type AppShellView,
} from "./components/app-shell/app-shell.tsx";
import {
  buildContractInspectorDetails,
  type InspectorCurationItem,
} from "./components/inspector/inspector-data.ts";
import { ProcessInspector } from "./components/inspector/process-inspector.tsx";
import type { GraphEditHandler } from "./components/process-canvas/types.ts";
import { WorkflowCanvas } from "./components/process-canvas/workflow-canvas.tsx";
import SetupView from "./components/setup/setup-view.tsx";
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

interface ObservedChannel {
  id: string;
  name: string;
  project_id: string | null;
  workflow_id: string | null;
}

interface WorkspaceSettings {
  auth: {
    provider: string;
    status: "configured" | "missing";
  };
  deployment: {
    activeTarget: "local" | "production" | "staging";
    controls: {
      enabled: boolean;
      href?: string;
      id: "actions" | "export" | "refresh";
      label: string;
    }[];
  };
  environment: "local" | "production" | "staging";
  extraction: { configured: boolean };
  generatedAt: string;
  releaseSha: string;
  slack: {
    channels: ObservedChannel[];
    status: "installed" | "not_installed";
    workspaceId: string | null;
    workspaceName: string | null;
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
  project_id: "" as ProjectId,
  view: "overlay",
  workspace_id: "",
};

const activityIdPrefixPattern = /^act_/;

function isTextEntryTarget(target: EventTarget | null) {
  return target instanceof HTMLElement
    ? target.matches("input, textarea, select, [contenteditable='true']")
    : false;
}

function isCanvasClearKey(key: string) {
  return key === "backspace" || key === "delete" || key === "escape";
}

function isUndoShortcut(event: KeyboardEvent, key: string) {
  return (event.metaKey || event.ctrlKey) && key === "z";
}

// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: The route component coordinates the app shell, snapshot/SSE lifecycle, curation and agent controls.
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
  const [modelEditing, setModelEditing] = useState(false);
  const [addNodeLabel, setAddNodeLabel] = useState("");
  const [question, setQuestion] = useState("");
  const [asking, setAsking] = useState(false);
  const [answer, setAnswer] = useState<AskAnswer | null>(null);
  const lastCanvasSelection = useRef<AppSelection | null>(null);
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
        const [firstChannel] = payload.slack.channels;
        const scoped = {
          ...stateRef.current.scope,
          channel: firstChannel?.id ?? "",
          project_id: (stateRef.current.scope.project_id ||
            firstChannel?.project_id ||
            "") as ProjectId,
          workflow_id: (stateRef.current.scope.workflow_id ||
            firstChannel?.workflow_id ||
            undefined) as ConnectionScope["workflow_id"],
          workspace_id: payload.slack.workspaceId ?? "",
        };
        setSettings(payload);
        setState((current) => ({
          ...current,
          scope: scoped,
          scopeKey: scopeKey(scoped),
        }));
        // Nothing to render until a channel is bound to a project, so land the
        // user on setup instead of an empty canvas.
        if (!firstChannel?.project_id) {
          setShellView("setup");
        }
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
    if (!scope.project_id) {
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
  const observedChannels = useMemo(
    () => settings?.slack.channels ?? [],
    [settings]
  );

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

  // Projects come from the workspace's own knowledge base. Before setup runs
  // there are none, and the setup view is what the user sees instead.
  const projectOptions = useMemo(
    () =>
      state.kb?.projects.map((project) => ({
        id: project.id,
        label: project.name,
        workflowId: project.workflow_id,
      })) ?? [],
    [state.kb]
  );
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
    : undefined;
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
    const opensInspectorView = Boolean(
      selection.case_id || selection.message_id
    );
    setShellView(opensInspectorView ? "inspector" : "graph");
    setState((current) => ({
      ...current,
      selection: {
        ...selection,
        workflow_id: selection.workflow_id ?? current.scope.workflow_id,
      },
    }));
  };

  const clearSelection = useCallback(() => {
    setState((current) => ({
      ...current,
      selection: { workflow_id: current.scope.workflow_id },
    }));
  }, []);

  const hasActiveCanvasSelection = useCallback(
    () =>
      Boolean(
        stateRef.current.selection.edge_id || stateRef.current.selection.node_id
      ),
    []
  );

  const restoreLastCanvasSelection = useCallback((event: KeyboardEvent) => {
    const previous = lastCanvasSelection.current;
    if (!previous) {
      return;
    }
    event.preventDefault();
    setState((current) => ({
      ...current,
      selection: {
        ...previous,
        workflow_id: previous.workflow_id ?? current.scope.workflow_id,
      },
    }));
  }, []);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (isTextEntryTarget(event.target) || shellView !== "graph") {
        return;
      }
      const key = event.key.toLowerCase();
      if (isUndoShortcut(event, key)) {
        restoreLastCanvasSelection(event);
        return;
      }
      if (hasActiveCanvasSelection() && isCanvasClearKey(key)) {
        event.preventDefault();
        clearSelection();
      }
    };
    window.addEventListener("keydown", onKeyDown, { capture: true });
    return () =>
      window.removeEventListener("keydown", onKeyDown, { capture: true });
  }, [
    clearSelection,
    hasActiveCanvasSelection,
    restoreLastCanvasSelection,
    shellView,
  ]);

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

  const askAgent = useCallback(
    (prompt: string, signal: AbortSignal) =>
      adapter.ask(
        {
          project_id: state.scope.project_id,
          question: prompt,
          workflow_id: state.scope.workflow_id,
        },
        signal
      ),
    [adapter, state.scope.project_id, state.scope.workflow_id]
  );

  const editGraph = useCallback<GraphEditHandler>(
    async (action, payload) => {
      const { current } = stateRef;
      const currentGraph = selectCurrentGraph(current);
      const edit = normalizeGraphEdit(action, payload, currentGraph);
      if (!edit) {
        setNotice("This graph edit is not supported for the live model yet.");
        return;
      }
      setModelEditing(true);
      setNotice("");
      try {
        await adapter.applyModelEdit({
          action: edit.action,
          payload: edit.payload,
          request_id: crypto.randomUUID(),
          scope: current.scope,
        });
        setNotice("Graph model edit saved. Recalculating conformance...");
        setReloadToken((value) => value + 1);
      } catch (caught) {
        setNotice((caught as Error).message);
      } finally {
        setModelEditing(false);
      }
    },
    [adapter]
  );

  const submitAddNode = async (event: { preventDefault: () => void }) => {
    event.preventDefault();
    const label = addNodeLabel.trim();
    if (!label) {
      return;
    }
    setAddNodeLabel("");
    await editGraph("add_node", { label, slug: slugifyGraphLabel(label) });
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
          project_id: state.scope.project_id,
          question: prompt,
          thread_id: `${state.scope.project_id.slice(5)}-app`,
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
          disabled={state.loading.requestId !== null}
          onClick={() => setReloadToken((value) => value + 1)}
          type="button"
        >
          {state.loading.requestId === null ? (
            <RefreshCw size={14} />
          ) : (
            <LoaderCircle className="spin" size={16} />
          )}
          Refresh
        </button>
      }
      projectOptions={projectOptions}
      sidebarAction={
        <div className="channel-note">
          <span className="channel-orbit">
            <Hash size={19} />
          </span>
          <strong>Observed channels</strong>
          {observedChannels.length ? (
            <p>
              {observedChannels.map((channel) => `#${channel.name}`).join(", ")}
            </p>
          ) : (
            <p>No Slack channel is connected yet.</p>
          )}
          <button onClick={() => setShellView("setup")} type="button">
            Open setup <ArrowUpRight size={15} />
          </button>
        </div>
      }
      workspaceOptions={[
        {
          detail: observedChannels.length
            ? observedChannels.map((channel) => `#${channel.name}`).join(", ")
            : "No channel connected",
          id: "configured",
          label: settings?.slack.workspaceName ?? "Workspace",
        },
      ]}
    >
      <main>
        <div className="page-heading">
          <div>
            <div className="eyebrow">
              <span />
              OBSERVED FROM SLACK
            </div>
            <h1>{activeProject?.label ?? "Process workspace"}</h1>
            <p>
              Graph, evidence, curation and conformance mined from messages in
              this workspace's connected channels.
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
              disabled={state.loading.requestId !== null}
              onClick={() => setReloadToken((value) => value + 1)}
              type="button"
            >
              {state.loading.requestId === null ? (
                <RefreshCw size={16} />
              ) : (
                <LoaderCircle className="spin" size={16} />
              )}
              Refresh
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
        {state.loading.requestId && !graph && shellView !== "setup" ? (
          <div className="loading-state">
            <LoaderCircle className="spin" />
            <p>Loading process snapshot...</p>
          </div>
        ) : null}
        {shellView === "setup" ? (
          <SetupView
            onReady={() => {
              // Setup just became complete: reload settings so the scope picks
              // up the newly bound channel, then show the graph.
              setSettingsRefresh((value) => value + 1);
              setReloadToken((value) => value + 1);
              setShellView("graph");
            }}
          />
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
        ) : null}
        {shellView === "settings" || shellView === "setup" ? null : (
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
                    addNodeLabel={addNodeLabel}
                    canEdit={!modelEditing}
                    graph={graph}
                    modelEditing={modelEditing}
                    onAddNodeLabelChange={setAddNodeLabel}
                    onEdit={editGraph}
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
                    onSubmitAddNode={submitAddNode}
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
                {shellView === "chat" ? (
                  <AgentChatPanel
                    ask={askAgent}
                    disabled={state.loading.requestId !== null}
                    onInspectEvidence={() => setShellView("activity")}
                    scopeLabel={activeProject?.label ?? "Current process"}
                  />
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
              <div>
                <ProcessInspector
                  details={inspectorDetails}
                  onClearSelection={clearSelection}
                  onCuration={curate}
                  onInspectSources={() => setShellView("activity")}
                  onOpenContext={() => setShellView("activity")}
                />
              </div>
            </div>
          </section>
        )}
        {shellView === "settings" || shellView === "setup" ? null : (
          <div className="bottom-grid">
            <RecentEvidence messages={messages} onSelect={select} />
            {shellView === "chat" ? null : (
              <AssistantPanel
                answer={answer}
                ask={ask}
                asking={asking}
                question={question}
                setQuestion={setQuestion}
              />
            )}
            <VariantSummary graph={graph} />
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

function VariantSummary({
  graph,
}: {
  graph: ReturnType<typeof selectCurrentGraph>;
}) {
  const nodeLabel = new Map(
    (graph?.nodes ?? []).map((node) => [node.id, node.activity.label])
  );
  // A variant is a path work actually took. A designed edge nobody has walked
  // is not a way the process unfolds, so zero-support edges are excluded rather
  // than presented as observed behaviour.
  const variants = (graph?.edges ?? [])
    .filter((edge) => edge.observed_support > 0)
    .sort((a, b) => b.observed_support - a.observed_support)
    .slice(0, 4);
  return (
    <section className="variants-panel">
      <div className="card-heading">
        <h2>
          <GitBranch size={17} />
          The ways this process unfolds
        </h2>
      </div>
      <div className="variant-list">
        {variants.length ? (
          variants.map((edge) => {
            const from = nodeLabel.get(edge.from) ?? edge.from;
            const to = nodeLabel.get(edge.to) ?? edge.to;
            return (
              <article className="variant-row" key={edge.id}>
                <strong>
                  {from} → {to}
                </strong>
                <span>
                  {edge.observed_support} observed transition
                  {edge.observed_support === 1 ? "" : "s"}
                </span>
              </article>
            );
          })
        ) : (
          <div className="empty">
            No variants observed yet. Variants appear once messages in a
            connected channel describe work.
          </div>
        )}
      </div>
    </section>
  );
}

function MapPanel({
  addNodeLabel,
  canEdit,
  graph,
  modelEditing,
  onAddNodeLabelChange,
  onEdit,
  onModeChange,
  onReload,
  onSelect,
  onSubmitAddNode,
  selection,
}: {
  addNodeLabel: string;
  canEdit: boolean;
  graph: ReturnType<typeof selectCurrentGraph>;
  modelEditing: boolean;
  onAddNodeLabelChange: (value: string) => void;
  onEdit: GraphEditHandler;
  onModeChange: (view: ConnectionScope["view"]) => void;
  onReload: () => void;
  onSelect: (selection: AppSelection) => void;
  onSubmitAddNode: (event: { preventDefault: () => void }) => void;
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
      <GraphEditStrip
        addNodeLabel={addNodeLabel}
        canEdit={canEdit}
        modelEditing={modelEditing}
        onAddNodeLabelChange={onAddNodeLabelChange}
        onSubmitAddNode={onSubmitAddNode}
      />
      <div>
        <WorkflowCanvas
          canEdit={canEdit}
          graph={graph}
          onEdit={onEdit}
          onModeChange={onModeChange}
          onSelectionChange={onSelect}
          selection={selection}
        />
      </div>
    </>
  );
}

function GraphEditStrip({
  addNodeLabel,
  canEdit,
  modelEditing,
  onAddNodeLabelChange,
  onSubmitAddNode,
}: {
  addNodeLabel: string;
  canEdit: boolean;
  modelEditing: boolean;
  onAddNodeLabelChange: (value: string) => void;
  onSubmitAddNode: (event: { preventDefault: () => void }) => void;
}) {
  return (
    <div className="graph-edit-strip" role="toolbar">
      <form onSubmit={onSubmitAddNode}>
        <input
          aria-label="New graph node label"
          disabled={!canEdit}
          maxLength={80}
          onChange={(event) => onAddNodeLabelChange(event.target.value)}
          placeholder="Add documented step"
          value={addNodeLabel}
        />
        <button disabled={!(canEdit && addNodeLabel.trim())} type="submit">
          {modelEditing ? (
            <LoaderCircle className="spin" size={13} />
          ) : (
            <Sparkles size={13} />
          )}
          Add
        </button>
      </form>
      <span>
        Drag to connect, select a node to rename, promote, retire, or reject.
      </span>
    </div>
  );
}

function normalizeGraphEdit(
  action: Parameters<GraphEditHandler>[0],
  payload: Record<string, string>,
  graph: ReturnType<typeof selectCurrentGraph>
): {
  action: ModelEditAction;
  payload: Record<string, boolean | number | string | string[]>;
} | null {
  const slugFor = (value: string | undefined) => {
    if (!value) {
      return "";
    }
    return (
      graph?.nodes.find(
        (node) => node.id === value || node.activity.slug === value
      )?.activity.slug ?? value.replace(activityIdPrefixPattern, "")
    );
  };
  switch (action) {
    case "add_node":
      return {
        action,
        payload: {
          label: payload.label ?? "",
          slug: payload.slug || slugifyGraphLabel(payload.label ?? ""),
        },
      };
    case "add_edge":
    case "require":
      return {
        action: "add_edge",
        payload: {
          from_slug: slugFor(payload.source ?? payload.from),
          to_slug: slugFor(payload.target ?? payload.to),
        },
      };
    case "merge":
      return {
        action,
        payload: {
          source_slug: slugFor(payload.source),
          target_slug: slugFor(payload.target),
        },
      };
    case "rename":
      return {
        action,
        payload: { label: payload.label ?? "", slug: slugFor(payload.id) },
      };
    case "retire":
      return {
        action,
        payload: { acknowledged_policy_ids: [], slug: slugFor(payload.id) },
      };
    case "promote":
      return { action, payload: { slug: slugFor(payload.id) } };
    case "remove_edge":
      return {
        action,
        payload: {
          from_slug: slugFor(payload.source ?? payload.from),
          to_slug: slugFor(payload.target ?? payload.to),
        },
      };
    case "remove_node":
      return {
        action,
        payload: { acknowledged_policy_ids: [], slug: slugFor(payload.id) },
      };
    default:
      return null;
  }
}

function slugifyGraphLabel(value: string) {
  const slug = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
  return slug || `step_${Date.now()}`;
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
          <div className="empty">
            No evidence yet. Messages from a connected Slack channel appear here
            once they are extracted into steps.
          </div>
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
          <strong>{settings?.slack.workspaceName ?? "Not connected"}</strong>
          <small>
            {settings?.slack.channels.length
              ? settings.slack.channels
                  .map((channel) => `#${channel.name}`)
                  .join(", ")
              : "No channel connected"}
          </small>
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
          <span>Extraction</span>
          <strong>
            {settings?.extraction.configured ? "configured" : "missing key"}
          </strong>
          <small>
            {settings?.extraction.configured
              ? "Steps are extracted from new Slack messages"
              : "Set OPENROUTER_API_KEY to extract steps"}
          </small>
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
            <h3>Deployment</h3>
            <p>
              GitHub Actions deploys staging and production to separate
              Cloudflare Workers and D1 databases. This runtime is{" "}
              {settings?.deployment.activeTarget ?? "local"}.
            </p>
          </div>
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
  if (settings?.slack.status === "not_installed") {
    return "Slack not connected";
  }
  if (settings && settings.slack.channels.length === 0) {
    return "No channel connected";
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
