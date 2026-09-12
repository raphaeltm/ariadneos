import { AccountMenu } from "./auth-gate.tsx";
import "@xyflow/react/dist/style.css";
import {
  Activity,
  ArrowDownToLine,
  ArrowRight,
  ArrowUpRight,
  Check,
  Clock3,
  GitBranch,
  Layers3,
  LoaderCircle,
  Play,
  Search,
  Send,
  Sparkles,
  Waypoints,
  X,
} from "lucide-react";
import {
  type Dispatch,
  type SetStateAction,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  type ActivityEvent,
  duration,
  type ProcessModel,
  type Snapshot,
  type WorkflowId,
  workflows,
} from "../shared/process.ts";
import AppShell, {
  type AppShellView,
} from "./components/app-shell/app-shell.tsx";
import { buildLegacyInspectorDetails } from "./components/inspector/inspector-data.ts";
import { ProcessInspector } from "./components/inspector/process-inspector.tsx";
import {
  applyCurationEdits,
  type CurationAction,
  type CurationDraft,
  createCurationDraft,
  curationSummary,
  persistCurationDraft,
  persistCurationUndo,
  undoLastCurationDraft,
  updateCurationDraft,
} from "./curation.ts";
import ProcessGraph from "./process-graph.tsx";

interface Selection {
  id: string;
  kind: "node" | "edge";
}
interface Answer {
  answer: string;
  evidence: string[];
  mode: "ai" | "summary";
  notice?: string;
}
async function api<T>(path: string, body?: unknown): Promise<T> {
  const response = await fetch(
    path,
    body
      ? {
          body: JSON.stringify(body),
          headers: { "Content-Type": "application/json" },
          method: "POST",
        }
      : undefined
  );
  const json = (await response.json()) as T & { error?: string };
  if (!response.ok) {
    throw new Error(json.error ?? "Unable to reach AriadneOS.");
  }
  return json;
}
const initials = (name: string) =>
  name
    .split(" ")
    .map((n) => n[0])
    .join("");
const time = (date: string) =>
  new Date(date).toLocaleString(undefined, {
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    month: "short",
  });
const explorerTabs = [
  ["map", "Process map", Waypoints],
  ["variants", "Variants", GitBranch],
  ["events", "Event log", Activity],
] as const;
export default function App() {
  const [workflow, setWorkflow] = useState<WorkflowId>("vendor");
  const [data, setData] = useState<Snapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const [tab, setTab] = useState("map");
  const [shellView, setShellView] = useState<AppShellView>("graph");
  const [workspace, setWorkspace] = useState("demo");
  const [selection, setSelection] = useState<Selection>();
  const [caseId, setCaseId] = useState<string>();
  const [search, setSearch] = useState("");
  const [info, setInfo] = useState(false);
  const [question, setQuestion] = useState("");
  const [answer, setAnswer] = useState<Answer>();
  const [asking, setAsking] = useState(false);
  const [refresh, setRefresh] = useState(0);
  const [curationEdits, setCurationEdits] = useState<CurationDraft[]>([]);
  const currentWorkflow = useRef(workflow);
  currentWorkflow.current = workflow;
  // biome-ignore lint/correctness/useExhaustiveDependencies: Refresh intentionally invalidates this request after a simulation.
  useEffect(() => {
    let active = true;
    setLoading(true);
    setData(null);
    setError("");
    setSelection(undefined);
    setCaseId(undefined);
    setAnswer(undefined);
    setSearch("");
    setCurationEdits([]);
    api<Snapshot>(`/api/model?workflow=${workflow}`)
      .then((d) => {
        if (active) {
          setData(d);
        }
      })
      .catch((e) => {
        if (active) {
          setError(e.message);
        }
      })
      .finally(() => {
        if (active) {
          setLoading(false);
        }
      });
    return () => {
      active = false;
    };
  }, [workflow, refresh]);
  async function run() {
    setBusy(true);
    setError("");
    try {
      const result = await api<{ addedCases: number; addedEvents: number }>(
        "/api/simulate",
        { workflow }
      );
      setNotice(
        `Observed ${result.addedEvents} new events across ${result.addedCases} cases. Process model updated.`
      );
      setCurationEdits([]);
      setRefresh((x) => x + 1);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function ask(text = question) {
    if (!text.trim() || asking) {
      return;
    }
    setQuestion(text);
    setAsking(true);
    setAnswer(undefined);
    try {
      const result = await api<Answer>("/api/ask", {
        question: text,
        workflow,
      });
      if (currentWorkflow.current === workflow) {
        setAnswer(result);
      }
    } catch (e) {
      if (currentWorkflow.current !== workflow) {
        return;
      }
      setAnswer({
        answer: (e as Error).message,
        evidence: [],
        mode: "summary",
        notice: "Request failed. Try again.",
      });
    } finally {
      setAsking(false);
    }
  }
  function exportModel() {
    if (!data) {
      return;
    }
    const url = URL.createObjectURL(
      new Blob([JSON.stringify(data, null, 2)], { type: "application/json" })
    );
    const a = document.createElement("a");
    a.href = url;
    a.download = `ariadneos-${workflow}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }
  const model = data?.model;
  const curationProjection = useMemo(
    () => (model ? applyCurationEdits(model, curationEdits) : undefined),
    [curationEdits, model]
  );
  const visibleModel = curationProjection?.model ?? model;
  const curationStats = useMemo(
    () => curationSummary(curationEdits),
    [curationEdits]
  );
  const { selectedNode, selectedEdge, evidenceIds } = selectionEvidence(
    visibleModel,
    selection
  );
  const events = filterEvents(
    data?.events ?? [],
    caseId,
    selectedNode?.id,
    evidenceIds,
    selection?.kind === "edge",
    search
  );
  const { handleCurationAction, handleUndoCuration } = useGraphCuration({
    curationEdits,
    setCurationEdits,
    setNotice,
    visibleModel,
    workflow,
  });
  useCurationShortcuts({
    handleCurationAction,
    handleUndoCuration,
    selection,
    visibleModel,
  });
  function chooseWorkflow(id: WorkflowId) {
    setWorkflow(id);
    setTab("map");
    setShellView("graph");
    setNotice("");
    setCurationEdits([]);
  }
  function navigateShell(view: AppShellView) {
    setShellView(view);
    setTab(view === "settings" ? "settings" : "map");
  }
  const projectOptions = workflows.map((item) => ({
    id: item.id,
    label: item.name,
  }));
  const workspaceOptions = [
    {
      detail: "Demo workspace",
      id: "demo",
      label: "Acme Studio",
    },
  ];
  return (
    <AppShell
      accountMenu={<AccountMenu />}
      activeProjectId={workflow}
      activeView={tab === "settings" ? "settings" : shellView}
      activeWorkspaceId={workspace}
      connectionLabel="Demo environment"
      onAbout={() => setInfo(true)}
      onNavigate={navigateShell}
      onProjectChange={(id) => chooseWorkflow(id as WorkflowId)}
      onWorkspaceChange={setWorkspace}
      primaryAction={
        <CompactRunButton
          busy={busy}
          loading={loading}
          onRun={run}
          remainingRuns={data?.remainingRuns}
        />
      }
      projectOptions={projectOptions}
      sidebarAction={
        <SidebarRunCard
          busy={busy}
          loading={loading}
          onRun={run}
          remainingRuns={data?.remainingRuns}
        />
      }
      workspaceOptions={workspaceOptions}
    >
      <main>
        <div className="page-heading">
          <div>
            <div className="eyebrow">
              <span />
              PROCESS INTELLIGENCE
            </div>
            <h1>Follow the work.</h1>
            <p>
              Your organization’s activity, connected into a living process.
            </p>
          </div>
          <div className="heading-actions">
            <button
              className="button secondary"
              disabled={!data || loading}
              onClick={exportModel}
              type="button"
            >
              <ArrowDownToLine size={16} />
              Export model
            </button>
            <button
              className="button primary"
              disabled={busy || loading || data?.remainingRuns === 0}
              onClick={run}
              type="button"
            >
              {busy ? (
                <LoaderCircle className="spin" size={16} />
              ) : (
                <Play fill="currentColor" size={14} />
              )}
              {busy ? "Observing…" : "Simulate activity"}
            </button>
          </div>
        </div>
        {Boolean(error) && (
          <div className="banner error" role="alert">
            {error}
            <button onClick={() => setRefresh((x) => x + 1)} type="button">
              Retry
            </button>
          </div>
        )}
        {Boolean(notice) && (
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
        )}
        <WorkspaceStatus
          loading={loading}
          onReload={() => setRefresh((x) => x + 1)}
          ready={Boolean(model && data)}
        />
        {!loading && model !== undefined && data !== null && (
          <LoadedWorkspace
            answer={answer}
            ask={ask}
            asking={asking}
            caseId={caseId}
            curationProjection={curationProjection}
            curationStats={curationStats}
            data={data}
            displayModel={visibleModel ?? model}
            events={events}
            handleCurationAction={handleCurationAction}
            handleUndoCuration={handleUndoCuration}
            model={model}
            onAbout={() => setInfo(true)}
            onGraphSelect={(selected) => {
              setSelection(selected);
              setCaseId(undefined);
              setShellView("inspector");
            }}
            onReload={() => setRefresh((x) => x + 1)}
            question={question}
            search={search}
            selectedEdge={selectedEdge}
            selectedNode={selectedNode}
            selection={selection}
            setCaseId={setCaseId}
            setQuestion={setQuestion}
            setSearch={setSearch}
            setSelection={setSelection}
            setTab={setTab}
            tab={tab}
            workflow={workflow}
            workspace={workspace}
          />
        )}
      </main>
      {info ? <AboutDialog onClose={() => setInfo(false)} /> : null}
    </AppShell>
  );
}

function CompactRunButton({
  busy,
  loading,
  onRun,
  remainingRuns,
}: {
  busy: boolean;
  loading: boolean;
  onRun: () => void;
  remainingRuns: number | undefined;
}) {
  return (
    <button
      className="button topbar-action"
      disabled={busy || loading || remainingRuns === 0}
      onClick={onRun}
      type="button"
    >
      {busy ? (
        <LoaderCircle className="spin" size={16} />
      ) : (
        <Play fill="currentColor" size={13} />
      )}
      Run
    </button>
  );
}

function SidebarRunCard({
  busy,
  loading,
  onRun,
  remainingRuns,
}: {
  busy: boolean;
  loading: boolean;
  onRun: () => void;
  remainingRuns: number | undefined;
}) {
  return (
    <div className="demo-note">
      <span className="demo-orbit">
        <Sparkles size={19} />
      </span>
      <strong>A little work. A bigger picture.</strong>
      <p>Simulate activity and watch the hidden process emerge.</p>
      <button
        disabled={busy || loading || remainingRuns === 0}
        onClick={onRun}
        type="button"
      >
        Run a simulation <ArrowUpRight size={15} />
      </button>
    </div>
  );
}

interface CurationTarget {
  id: string;
  kind: "edge" | "node";
}

interface LoadedWorkspaceProps {
  answer: Answer | undefined;
  ask: (text?: string) => Promise<void>;
  asking: boolean;
  caseId: string | undefined;
  curationProjection: ReturnType<typeof applyCurationEdits> | undefined;
  curationStats: ReturnType<typeof curationSummary>;
  data: Snapshot;
  displayModel: ProcessModel;
  events: ActivityEvent[];
  handleCurationAction: (
    action: CurationAction,
    target: CurationTarget
  ) => void;
  handleUndoCuration: () => void;
  model: ProcessModel;
  onAbout: () => void;
  onGraphSelect: (selection: Selection) => void;
  onReload: () => void;
  question: string;
  search: string;
  selectedEdge: Snapshot["model"]["edges"][number] | undefined;
  selectedNode: Snapshot["model"]["nodes"][number] | undefined;
  selection: Selection | undefined;
  setCaseId: (value: string | undefined) => void;
  setQuestion: (value: string) => void;
  setSearch: (value: string) => void;
  setSelection: (value: Selection | undefined) => void;
  setTab: (value: string) => void;
  tab: string;
  workflow: WorkflowId;
  workspace: string;
}

function LoadedWorkspace(props: LoadedWorkspaceProps) {
  return (
    <>
      <WorkspaceStats model={props.model} />
      {props.tab === "settings" ? (
        <SettingsPanel
          data={props.data}
          onAbout={props.onAbout}
          onReload={props.onReload}
          workflow={props.workflow}
          workspace={props.workspace}
        />
      ) : (
        <ProcessExplorer {...props} />
      )}
      {props.tab !== "settings" && <RecentAndAssistant {...props} />}
      <WorkspaceFooter remainingRuns={props.data.remainingRuns} />
    </>
  );
}

function WorkspaceStats({ model }: { model: ProcessModel }) {
  return (
    <div className="stats-row">
      <Stat
        icon={<Activity size={17} />}
        label="Observed events"
        sub="Every action, accounted for"
        value={model.stats.events.toLocaleString()}
      />
      <Stat
        icon={<Layers3 size={17} />}
        label="Process cases"
        sub="Individual workflow journeys"
        value={String(model.stats.cases)}
      />
      <Stat
        icon={<GitBranch size={17} />}
        label="Discovered variants"
        sub="Different paths through the work"
        value={String(model.stats.variants).padStart(2, "0")}
      />
      <Stat
        icon={<Clock3 size={17} />}
        label="Median cycle time"
        sub="First observation to last"
        value={duration(model.stats.medianMinutes)}
      />
    </div>
  );
}

function ProcessExplorer(props: LoadedWorkspaceProps) {
  return (
    <section className="explorer">
      <div className="explorer-header">
        <div className="process-title">
          <span className="process-icon">
            <GitBranch size={20} />
          </span>
          <div>
            <h2>{props.data.workflow.name}</h2>
            <p>{props.data.workflow.description}</p>
          </div>
        </div>
        <span className="source-chip">
          <span className="online-dot" />
          Synthetic observations
        </span>
      </div>
      <ExplorerToolbar
        model={props.model}
        setTab={props.setTab}
        tab={props.tab}
      />
      <div className="explorer-body">
        <div className="main-panel">
          <MapPanel {...props} />
          {props.tab === "variants" && (
            <VariantsPanel
              model={props.model}
              setCaseId={props.setCaseId}
              setSelection={props.setSelection}
              setTab={props.setTab}
            />
          )}
          <EventsTabPanel {...props} />
        </div>
        <Inspector
          events={props.events}
          model={props.displayModel}
          selectedEdge={props.selectedEdge}
          selectedNode={props.selectedNode}
          selection={props.selection}
          setCaseId={props.setCaseId}
          setSelection={props.setSelection}
          setTab={props.setTab}
          workflow={props.workflow}
        />
      </div>
    </section>
  );
}

function ExplorerToolbar({
  model,
  setTab,
  tab,
}: {
  model: ProcessModel;
  setTab: (value: string) => void;
  tab: string;
}) {
  return (
    <div className="explorer-toolbar">
      <div className="tabs">
        {explorerTabs.map(([id, label, Icon]) => (
          <button
            className={tab === id ? "selected" : ""}
            key={id}
            onClick={() => setTab(id)}
            type="button"
          >
            <Icon size={15} />
            <span>{label}</span>
            {id === "variants" && (
              <span className="tab-count">{model.stats.variants}</span>
            )}
          </button>
        ))}
      </div>
      <span className="observation-range">
        {model.stats.cases} completed cases <span>·</span>{" "}
        {Math.round(model.stats.dominantShare * 100)}% follow the main path
      </span>
    </div>
  );
}

function MapPanel(props: LoadedWorkspaceProps) {
  if (props.tab !== "map") {
    return null;
  }
  return (
    <>
      <div className="graph-hint">
        <span className="tiny-dot" />
        Discovered from observed activity
        <span>
          {props.curationStats.active
            ? graphCurationHint(props.curationStats)
            : "Click a step or connection to see its evidence"}
        </span>
      </div>
      <div className="graph-canvas">
        <ProcessGraph
          curation={props.curationProjection}
          model={props.displayModel}
          onCurate={props.handleCurationAction}
          onSelect={props.onGraphSelect}
          selected={props.selection?.id}
        />
      </div>
      <CurationStatusBar
        onUndo={props.handleUndoCuration}
        stats={props.curationStats}
      />
      <div className="graph-legend">
        <span>
          <i className="legend-line" />
          Common transition
        </span>
        <span>
          <i className="legend-line dashed" />
          Less frequent path
        </span>
        <span className="legend-right">Count · transition probability</span>
      </div>
    </>
  );
}

function EventsTabPanel({
  caseId,
  events,
  search,
  selection,
  setCaseId,
  setSearch,
  setSelection,
  tab,
}: LoadedWorkspaceProps) {
  if (tab !== "events") {
    return null;
  }
  return (
    <div className="events-panel">
      <div className="event-controls">
        <label>
          <Search size={16} />
          <input
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search events, actors, cases…"
            value={search}
          />
        </label>
        {Boolean(selection || caseId) && (
          <button
            onClick={() => {
              setSelection(undefined);
              setCaseId(undefined);
            }}
            type="button"
          >
            <X size={13} />
            Clear filters
          </button>
        )}
      </div>
      <div className="event-summary">
        {caseId ? `Case ${caseId} · ` : ""}
        {events.length} matching observations
      </div>
      <EventList
        events={events}
        onCase={(id) => {
          setSelection(undefined);
          setCaseId(id);
        }}
      />
    </div>
  );
}

function RecentAndAssistant({
  answer,
  ask,
  asking,
  data,
  question,
  setCaseId,
  setQuestion,
  setSelection,
  setTab,
}: LoadedWorkspaceProps) {
  return (
    <div className="bottom-grid">
      <RecentObservations
        data={data}
        setCaseId={setCaseId}
        setSelection={setSelection}
        setTab={setTab}
      />
      <AssistantPanel
        answer={answer}
        ask={ask}
        asking={asking}
        question={question}
        setCaseId={setCaseId}
        setQuestion={setQuestion}
        setSelection={setSelection}
        setTab={setTab}
      />
    </div>
  );
}

function RecentObservations({
  data,
  setCaseId,
  setSelection,
  setTab,
}: {
  data: Snapshot;
  setCaseId: (value: string | undefined) => void;
  setSelection: (value: Selection | undefined) => void;
  setTab: (value: string) => void;
}) {
  return (
    <section className="recent-card">
      <div className="card-heading">
        <h2>
          <Activity size={17} />
          Recent observations
        </h2>
        <button
          onClick={() => {
            setSelection(undefined);
            setCaseId(undefined);
            setTab("events");
          }}
          type="button"
        >
          View all <ArrowUpRight size={14} />
        </button>
      </div>
      <EventList
        compact
        events={[...data.events]
          .sort((a, b) => b.timestamp.localeCompare(a.timestamp))
          .slice(0, 4)}
        onCase={(id) => {
          setSelection(undefined);
          setCaseId(id);
          setTab("events");
        }}
      />
    </section>
  );
}

function WorkspaceFooter({ remainingRuns }: { remainingRuns: number }) {
  return (
    <footer>
      <span>
        <span className="online-dot" />
        Observed. Connected. Understood.
      </span>
      <span>
        AriadneOS preview <span>·</span> {remainingRuns} simulation runs left
      </span>
    </footer>
  );
}

function CurationStatusBar({
  onUndo,
  stats,
}: {
  onUndo: () => void;
  stats: ReturnType<typeof curationSummary>;
}) {
  if (stats.active === 0) {
    return null;
  }
  return (
    <div className="curation-status" role="status">
      <span>
        {stats.saved} saved · {stats.local} local · {stats.failed} failed
      </span>
      <button onClick={onUndo} type="button">
        Undo last edit
      </button>
    </div>
  );
}

function useGraphCuration({
  curationEdits,
  setCurationEdits,
  setNotice,
  visibleModel,
  workflow,
}: {
  curationEdits: CurationDraft[];
  setCurationEdits: Dispatch<SetStateAction<CurationDraft[]>>;
  setNotice: (value: string) => void;
  visibleModel: ProcessModel | undefined;
  workflow: WorkflowId;
}) {
  const handleCurationAction = useCallback(
    (action: CurationAction, target: CurationTarget) => {
      if (!visibleModel) {
        return;
      }
      const draft = buildCurationDraft(action, target, visibleModel, setNotice);
      if (!draft) {
        return;
      }
      setCurationEdits((edits) => [...edits, draft]);
      setNotice(`${sentenceCase(action)} applied optimistically.`);
      saveCurationDraft(draft, workflow, setCurationEdits, setNotice);
    },
    [setCurationEdits, setNotice, visibleModel, workflow]
  );
  const handleUndoCuration = useCallback(() => {
    const lastEdit = findLastActiveCurationEdit(curationEdits);
    if (!lastEdit) {
      return;
    }
    setCurationEdits((edits) => undoLastCurationDraft(edits));
    setNotice("Last curation edit undone.");
    if (lastEdit.persistence === "saved") {
      saveCurationUndo(workflow, setNotice);
    }
  }, [curationEdits, setCurationEdits, setNotice, workflow]);
  return { handleCurationAction, handleUndoCuration };
}

function buildCurationDraft(
  action: CurationAction,
  target: CurationTarget,
  visibleModel: ProcessModel,
  setNotice: (value: string) => void
): CurationDraft | undefined {
  try {
    return createCurationDraft({
      action,
      model: visibleModel,
      targetId: target.id,
      targetKind: target.kind,
    });
  } catch (caught) {
    setNotice((caught as Error).message);
    return undefined;
  }
}

function saveCurationDraft(
  draft: CurationDraft,
  workflow: WorkflowId,
  setCurationEdits: Dispatch<SetStateAction<CurationDraft[]>>,
  setNotice: (value: string) => void
) {
  persistCurationDraft(draft, workflow)
    .then((result) => {
      setCurationEdits((edits) =>
        updateCurationDraft(edits, draft.id, {
          persistence: result.persisted ? "saved" : "local",
        })
      );
      if (!result.persisted) {
        setNotice(
          `${sentenceCase(draft.action)} is local until model edits are available.`
        );
      }
    })
    .catch((caught) => {
      setCurationEdits((edits) =>
        updateCurationDraft(edits, draft.id, { persistence: "failed" })
      );
      setNotice((caught as Error).message);
    });
}

function saveCurationUndo(
  workflow: WorkflowId,
  setNotice: (value: string) => void
) {
  persistCurationUndo(workflow).catch((caught) => {
    setNotice((caught as Error).message);
  });
}

function useCurationShortcuts({
  handleCurationAction,
  handleUndoCuration,
  selection,
  visibleModel,
}: {
  handleCurationAction: (
    action: CurationAction,
    target: CurationTarget
  ) => void;
  handleUndoCuration: () => void;
  selection: Selection | undefined;
  visibleModel: ProcessModel | undefined;
}) {
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (shouldIgnoreShortcut(event)) {
        return;
      }
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "z") {
        event.preventDefault();
        handleUndoCuration();
        return;
      }
      const action = shortcutAction(event.key);
      if (!(action && selection && visibleModel)) {
        return;
      }
      event.preventDefault();
      handleCurationAction(action, {
        id: selection.id,
        kind: selection.kind,
      });
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [handleCurationAction, handleUndoCuration, selection, visibleModel]);
}

function shortcutAction(key: string): CurationAction | undefined {
  const normalized = key.toLowerCase();
  if (normalized === "c") {
    return "confirm";
  }
  if (normalized === "m") {
    return "merge";
  }
  if (normalized === "s") {
    return "split";
  }
  if (normalized === "x") {
    return "reject";
  }
  return undefined;
}

function Stat({
  label,
  value,
  sub,
  icon,
}: {
  label: string;
  value: string;
  sub: string;
  icon: React.ReactNode;
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
function EventList({
  events,
  onCase,
  compact = false,
}: {
  events: ActivityEvent[];
  onCase: (id: string) => void;
  compact?: boolean;
}) {
  return (
    <div className={`event-list ${compact ? "compact" : ""}`}>
      {events.length ? (
        events.map((e) => (
          <div className="event-row" key={e.id}>
            <span className={`avatar ${avatarTone(e.role)}`}>
              {initials(e.actor)}
            </span>
            <div className="event-description">
              <strong>{e.actor}</strong>
              <span>
                {e.action} <i>· {e.artifact}</i>
              </span>
            </div>
            <button
              className="case-link"
              onClick={() => onCase(e.caseId)}
              type="button"
            >
              {e.caseId}
              <ArrowUpRight size={11} />
            </button>
            <time dateTime={e.timestamp}>{time(e.timestamp)}</time>
          </div>
        ))
      ) : (
        <div className="empty">No observations match these filters.</div>
      )}
    </div>
  );
}

function avatarTone(role: string) {
  if (role === "Compliance") {
    return "clay";
  }
  return role === "Finance" ? "lavender" : "";
}

function AboutDialog({ onClose }: { onClose: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    dialog.current?.showModal();
  }, []);
  return (
    <dialog
      aria-labelledby="about-title"
      className="about-modal"
      onClose={onClose}
      ref={dialog}
    >
      {" "}
      <button
        aria-label="Close about dialog"
        className="modal-close"
        onClick={() => onClose()}
        type="button"
      >
        <X size={20} />
      </button>
      <span className="insight-icon">
        <Waypoints size={24} />
      </span>
      <h2 id="about-title">A map of how work happens.</h2>
      <p>
        AriadneOS turns activity into process context for people and agents.
        This working preview uses a synthetic organization with three workflows.
      </p>
      <div className="source-row">
        <span className="workspace-icon">
          <Play size={18} />
        </span>
        <div>
          <strong>Simulation harness</strong>
          <small>Connected · 72 baseline cases</small>
        </div>
        <span className="online-dot" />
      </div>
      <div className="source-row muted">
        <span className="workspace-icon">#</span>
        <div>
          <strong>Slack</strong>
          <small>Planned integration · not connected in this preview</small>
        </div>
      </div>
      <p>
        New simulations add six cases to your browser’s workspace, stored for up
        to 48 hours. Graphs and counts are calculated from event records. AI
        explanations use Cloudflare Workers AI when available.
      </p>
      <button
        className="button primary"
        onClick={() => onClose()}
        type="button"
      >
        Explore the process <ArrowRight size={16} />
      </button>
    </dialog>
  );
}

interface InspectorProps {
  events: ActivityEvent[];
  model: Snapshot["model"];
  selectedEdge: Snapshot["model"]["edges"][number] | undefined;
  selectedNode: Snapshot["model"]["nodes"][number] | undefined;
  selection: Selection | undefined;
  setCaseId: (value: string | undefined) => void;
  setSelection: (value: Selection | undefined) => void;
  setTab: (value: string) => void;
  workflow: WorkflowId;
}
function Inspector({
  model,
  selection,
  selectedNode,
  selectedEdge,
  events,
  workflow,
  setSelection,
  setCaseId,
  setTab,
}: InspectorProps) {
  const details = buildLegacyInspectorDetails({
    events,
    model,
    selectedEdge,
    selectedNode,
    selection,
  });
  return (
    <ProcessInspector
      details={details}
      onClearSelection={() => setSelection(undefined)}
      onInspectSources={() => {
        setCaseId(undefined);
        setTab(selection ? "events" : "variants");
      }}
      onOpenContext={() =>
        window.open(
          `/api/context?workflow=${workflow}`,
          "_blank",
          "noopener,noreferrer"
        )
      }
    />
  );
}

function SettingsPanel({
  data,
  workflow,
  workspace,
  onAbout,
  onReload,
}: {
  data: Snapshot;
  workflow: WorkflowId;
  workspace: string;
  onAbout: () => void;
  onReload: () => void;
}) {
  const workspaceLabel = workspace === "demo" ? "Acme Studio" : workspace;
  return (
    <section className="settings-panel">
      <div>
        <div className="section-kicker">WORKSPACE SETTINGS</div>
        <h2>Demo workspace controls</h2>
        <p>
          Scope, source, and navigation state for the current process explorer.
        </p>
      </div>
      <div className="settings-grid">
        <article>
          <span>Workspace</span>
          <strong>{workspaceLabel}</strong>
          <small>Synthetic observations · Slack auth gated</small>
        </article>
        <article>
          <span>Project</span>
          <strong>{data.workflow.name}</strong>
          <small>
            {workflow} · {data.workflow.description}
          </small>
        </article>
        <article>
          <span>Data source</span>
          <strong>Simulation harness</strong>
          <small>{data.remainingRuns} simulation runs left</small>
        </article>
        <article>
          <span>Client state</span>
          <strong>Scoped updates</strong>
          <small>
            Selection and view state stay inside the active workspace
          </small>
        </article>
      </div>
      <div className="settings-actions">
        <button className="button secondary" onClick={onReload} type="button">
          Reload workspace
        </button>
        <button className="button secondary" onClick={onAbout} type="button">
          About this demo <ArrowUpRight size={14} />
        </button>
      </div>
    </section>
  );
}

function filterEvents(
  events: ActivityEvent[],
  caseId: string | undefined,
  nodeId: string | undefined,
  evidenceIds: Set<string>,
  edgeSelected: boolean,
  search: string
) {
  return events
    .filter((e) => {
      if (caseId && e.caseId !== caseId) {
        return false;
      }
      if (nodeId && e.action !== nodeId) {
        return false;
      }
      if (edgeSelected && !evidenceIds.has(e.id)) {
        return false;
      }
      return (
        !search ||
        `${e.caseId} ${e.actor} ${e.action} ${e.artifact}`
          .toLowerCase()
          .includes(search.toLowerCase())
      );
    })
    .sort((a, b) => b.timestamp.localeCompare(a.timestamp));
}

interface AssistantPanelProps {
  answer: Answer | undefined;
  ask: (text?: string) => Promise<void>;
  asking: boolean;
  question: string;
  setCaseId: (value: string | undefined) => void;
  setQuestion: (value: string) => void;
  setSelection: (value: Selection | undefined) => void;
  setTab: (value: string) => void;
}
function AssistantPanel({
  answer,
  asking,
  question,
  ask,
  setQuestion,
  setTab,
  setSelection,
  setCaseId,
}: AssistantPanelProps) {
  return (
    <section className="assistant-card">
      <div className="assistant-heading">
        <span className="assistant-icon">
          <Sparkles size={19} />
        </span>
        <div>
          <h2>Ask the process</h2>
          <p>Answers grounded in the observations.</p>
        </div>
        <span className="beta">AI</span>
      </div>
      {answer ? (
        <div aria-live="polite" className="answer">
          <span className="answer-label">
            {answer.mode === "ai" ? "ARIADNE · WORKERS AI" : "COMPUTED SUMMARY"}
          </span>
          {Boolean(answer.notice) && <small>{answer.notice}</small>}
          <p>{answer.answer}</p>
          <button
            className="text-link"
            onClick={() => {
              setTab("events");
              setSelection(undefined);
              setCaseId(undefined);
            }}
            type="button"
          >
            Inspect supporting event log <ArrowUpRight size={12} />
          </button>
        </div>
      ) : (
        <div className="suggestions">
          <button
            onClick={() =>
              ask("What is the most common path, and who approves requests?")
            }
            type="button"
          >
            What normally happens? <ArrowUpRight size={13} />
          </button>
          <button
            onClick={() =>
              ask("Which paths are unusual, and what evidence supports that?")
            }
            type="button"
          >
            Where does the process branch? <ArrowUpRight size={13} />
          </button>
        </div>
      )}
      <form
        className="question-form"
        onSubmit={(e) => {
          e.preventDefault();
          ask();
        }}
      >
        <input
          aria-label="Ask a question about this process"
          disabled={asking}
          maxLength={400}
          onChange={(e) => setQuestion(e.target.value)}
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
      <div className="assistant-footnote">
        {asking
          ? "Reading the process evidence…"
          : "Read-only answers · Synthetic data · No actions executed"}
      </div>
    </section>
  );
}

interface VariantsPanelProps {
  model: Snapshot["model"];
  setCaseId: (value: string | undefined) => void;
  setSelection: (value: Selection | undefined) => void;
  setTab: (value: string) => void;
}
function VariantsPanel({
  model,
  setSelection,
  setCaseId,
  setTab,
}: VariantsPanelProps) {
  return (
    <div className="variants-panel">
      <div className="section-kicker">SAME WORK. DIFFERENT PATHS.</div>
      <h3>The ways this process unfolds</h3>
      <p>Sequences reconstructed from complete case histories.</p>
      {model.variants.map((v, i) => (
        <button
          className="variant-card"
          key={v.path.join()}
          onClick={() => {
            setSelection(undefined);
            setCaseId(v.caseIds[0]);
            setTab("events");
          }}
          type="button"
        >
          <div className="variant-head">
            <span>
              Variant {String(i + 1).padStart(2, "0")}
              {i === 0 && <em>Most common</em>}
            </span>
            <strong>
              {v.count} cases ·{" "}
              {Math.round((v.count / model.stats.cases) * 100)}%
            </strong>
          </div>
          <div className="variant-path">
            {v.path.map((p, j) => (
              <span key={v.path.slice(0, j + 1).join(" → ")}>
                {j > 0 && <ArrowRight size={12} />}
                <span>{p}</span>
              </span>
            ))}
          </div>
          <div className="variant-track">
            <i
              style={{
                width: `${(v.count / model.stats.cases) * 100}%`,
              }}
            />
          </div>
          <small>
            Inspect an example case <ArrowUpRight size={12} />
          </small>
        </button>
      ))}
    </div>
  );
}

function selectionEvidence(
  model: Snapshot["model"] | undefined,
  selection: Selection | undefined
) {
  const selectedNode = model?.nodes.find(
    (n) => selection?.kind === "node" && n.id === selection.id
  );
  const selectedEdge = model?.edges.find(
    (e) => selection?.kind === "edge" && e.id === selection.id
  );
  const evidenceIds = new Set(
    selectedEdge?.evidence.flatMap((e) => [e.from, e.to]) ?? []
  );

  return { evidenceIds, selectedEdge, selectedNode };
}

function WorkspaceStatus({
  loading,
  ready,
  onReload,
}: {
  loading: boolean;
  ready: boolean;
  onReload: () => void;
}) {
  if (loading) {
    return (
      <div className="loading-state">
        <LoaderCircle className="spin" />
        <p>Connecting the observations…</p>
      </div>
    );
  }
  if (ready) {
    return null;
  }
  return (
    <div className="loading-state">
      <p>No observations available.</p>
      <button className="button secondary" onClick={onReload} type="button">
        Reload workspace
      </button>
    </div>
  );
}

function sentenceCase(value: string) {
  return `${value.slice(0, 1).toUpperCase()}${value.slice(1)}`;
}

function graphCurationHint(stats: ReturnType<typeof curationSummary>) {
  return `${stats.active} curation edits · ${stats.pending} pending`;
}

function shouldIgnoreShortcut(event: KeyboardEvent) {
  const { target } = event;
  if (!(target instanceof HTMLElement)) {
    return false;
  }
  return (
    target.isContentEditable ||
    target.tagName === "INPUT" ||
    target.tagName === "SELECT" ||
    target.tagName === "TEXTAREA"
  );
}

function findLastActiveCurationEdit(
  edits: CurationDraft[]
): CurationDraft | undefined {
  for (let index = edits.length - 1; index >= 0; index -= 1) {
    const edit = edits[index];
    if (edit && !edit.undone) {
      return edit;
    }
  }
  return undefined;
}
