import { AccountMenu } from "./auth-gate.tsx";
import "@xyflow/react/dist/style.css";
import {
  Activity,
  ArrowDownToLine,
  ArrowRight,
  ArrowUpRight,
  Check,
  ChevronLeft,
  ChevronRight,
  Clock3,
  Cloud,
  ExternalLink,
  GitBranch,
  Layers3,
  LoaderCircle,
  MonitorPlay,
  Pause,
  Play,
  RefreshCw,
  RotateCcw,
  Search,
  Send,
  ShieldCheck,
  SlidersHorizontal,
  Sparkles,
  Square,
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
import { WorkflowCanvas } from "./components/process-canvas/workflow-canvas.tsx";
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
import {
  clampDemoStepIndex,
  type DemoPlaybackState,
  type DemoTarget,
  type DemoWalkthroughStep,
  demoStepLabel,
  demoWalkthroughSteps,
  firstDemoWalkthroughStep,
  nextDemoStepIndex,
} from "./demo-walkthrough.ts";
import {
  canvasSelectionFromLegacy,
  legacyProcessToGraphView,
  legacySelectionFromCanvas,
} from "./legacy-canvas-bridge.ts";

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

const demoStepKeyPattern = /^[1-6]$/;

interface DemoControllerInput {
  busy: boolean;
  data: Snapshot | null;
  loading: boolean;
  model: Snapshot["model"] | undefined;
  run: () => Promise<void>;
  setCaseId: Dispatch<SetStateAction<string | undefined>>;
  setNotice: Dispatch<SetStateAction<string>>;
  setSearch: Dispatch<SetStateAction<string>>;
  setSelection: Dispatch<SetStateAction<Selection | undefined>>;
  setShellView: Dispatch<SetStateAction<AppShellView>>;
  setTab: Dispatch<SetStateAction<string>>;
  workflow: WorkflowId;
}

function useDemoWalkthroughController({
  busy,
  data,
  loading,
  model,
  run,
  setCaseId,
  setNotice,
  setSearch,
  setSelection,
  setShellView,
  setTab,
  workflow,
}: DemoControllerInput) {
  const [demoMode, setDemoMode] = useState<DemoPlaybackState>("idle");
  const [demoStepIndex, setDemoStepIndex] = useState(0);
  const demoRunStarted = useRef(false);
  const currentDemoWorkflow = useRef(workflow);
  const demoStep: DemoWalkthroughStep =
    demoWalkthroughSteps[demoStepIndex] ?? firstDemoWalkthroughStep;
  const activeDemoTarget = demoMode === "idle" ? undefined : demoStep.target;
  const canRunSimulation =
    !(busy || loading) && data !== null && data.remainingRuns !== 0;
  const isDemoActive = (target: DemoTarget) => activeDemoTarget === target;
  const isDemoTarget = (target: DemoTarget) =>
    isDemoActive(target) ? "is-demo-focus" : "";
  const goToDemoStep = useCallback((index: number) => {
    setDemoStepIndex(clampDemoStepIndex(index));
    setDemoMode((current) => (current === "idle" ? "paused" : current));
  }, []);
  const advanceDemoStep = useCallback((direction: -1 | 1) => {
    setDemoStepIndex((current) => nextDemoStepIndex(current, direction));
    setDemoMode((current) => (current === "idle" ? "paused" : current));
  }, []);
  const stopDemo = useCallback(() => {
    setDemoMode("idle");
    setDemoStepIndex(0);
    setSelection(undefined);
    setCaseId(undefined);
    setNotice("");
  }, [setCaseId, setNotice, setSelection]);
  const restartDemo = useCallback(() => {
    demoRunStarted.current = false;
    setDemoStepIndex(0);
    setDemoMode("playing");
    setSelection(undefined);
    setCaseId(undefined);
    setSearch("");
    setTab("map");
    setShellView("graph");
  }, [setCaseId, setSearch, setSelection, setShellView, setTab]);
  const toggleDemoPlayback = useCallback(() => {
    setDemoMode((current) => {
      if (current === "playing") {
        return "paused";
      }
      return "playing";
    });
  }, []);
  useEffect(() => {
    if (currentDemoWorkflow.current === workflow) {
      return;
    }
    currentDemoWorkflow.current = workflow;
    demoRunStarted.current = false;
    setDemoMode("idle");
    setDemoStepIndex(0);
  });
  useEffect(() => {
    if (demoMode === "idle") {
      return;
    }
    switch (demoStep.action) {
      case "ask":
        setShellView("graph");
        setTab("map");
        break;
      case "events":
        setShellView("graph");
        setTab("events");
        setSelection(undefined);
        setCaseId(undefined);
        break;
      case "graph":
        setShellView("graph");
        setTab("map");
        setSelection(undefined);
        setCaseId(undefined);
        break;
      case "run":
        setShellView("graph");
        setTab("map");
        setSelection(undefined);
        setCaseId(undefined);
        if (!(demoRunStarted.current || !canRunSimulation)) {
          demoRunStarted.current = true;
          run().catch((error: unknown) => {
            setNotice((error as Error).message);
          });
        }
        break;
      case "select-edge": {
        setShellView("inspector");
        setTab("map");
        const edge = model?.edges.find((item) => item.evidence.length > 0);
        if (edge) {
          setSelection((current) =>
            current?.id === edge.id && current.kind === "edge"
              ? current
              : { id: edge.id, kind: "edge" }
          );
        }
        break;
      }
      case "select-node": {
        setShellView("inspector");
        setTab("map");
        const node =
          model?.nodes.find((item) => item.count > 1 && !item.terminal) ??
          model?.nodes[0];
        if (node) {
          setSelection((current) =>
            current?.id === node.id && current.kind === "node"
              ? current
              : { id: node.id, kind: "node" }
          );
        }
        break;
      }
      case "variants":
        setShellView("graph");
        setTab("variants");
        setSelection(undefined);
        setCaseId(undefined);
        break;
      default:
        break;
    }
  }, [
    canRunSimulation,
    demoMode,
    demoStep.action,
    model,
    run,
    setCaseId,
    setNotice,
    setSelection,
    setShellView,
    setTab,
  ]);
  useEffect(() => {
    if (demoMode !== "playing" || loading || busy) {
      return;
    }
    if (demoStepIndex === demoWalkthroughSteps.length - 1) {
      const timeout = window.setTimeout(() => setDemoMode("paused"), 1600);
      return () => window.clearTimeout(timeout);
    }
    const timeout = window.setTimeout(
      () => setDemoStepIndex((current) => nextDemoStepIndex(current, 1)),
      demoStep.durationMs
    );
    return () => window.clearTimeout(timeout);
  }, [busy, demoMode, demoStep.durationMs, demoStepIndex, loading]);
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || shouldIgnoreShortcut(event)) {
        return;
      }
      if (event.code === "Space") {
        event.preventDefault();
        toggleDemoPlayback();
        return;
      }
      if (event.key === "ArrowRight") {
        event.preventDefault();
        advanceDemoStep(1);
        return;
      }
      if (event.key === "ArrowLeft") {
        event.preventDefault();
        advanceDemoStep(-1);
        return;
      }
      if (demoStepKeyPattern.test(event.key)) {
        event.preventDefault();
        goToDemoStep(Number(event.key) - 1);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [advanceDemoStep, goToDemoStep, toggleDemoPlayback]);
  return {
    advanceDemoStep,
    demoMode,
    demoStepIndex,
    goToDemoStep,
    isDemoActive,
    isDemoTarget,
    restartDemo,
    stopDemo,
    toggleDemoPlayback,
  };
}

function activeShellView(tab: string, shellView: AppShellView) {
  if (tab === "settings") {
    return "settings";
  }
  return shellView;
}
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
  const [settings, setSettings] = useState<WorkspaceSettings | null>(null);
  const [settingsLoading, setSettingsLoading] = useState(true);
  const [settingsError, setSettingsError] = useState("");
  const [settingsRefresh, setSettingsRefresh] = useState(0);
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
  useEffect(() => {
    let active = true;
    setSettingsLoading(true);
    setSettingsError("");
    api<WorkspaceSettings>(`/api/settings?refresh=${settingsRefresh}`)
      .then((result) => {
        if (active) {
          setSettings(result);
        }
      })
      .catch((e) => {
        if (active) {
          setSettingsError((e as Error).message);
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
  const run = useCallback(async () => {
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
  }, [workflow]);
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
  const canvasGraph = useMemo(
    () =>
      visibleModel && data
        ? legacyProcessToGraphView(visibleModel, workflow, data.generatedAt)
        : undefined,
    [data, visibleModel, workflow]
  );
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
  const {
    advanceDemoStep,
    demoMode,
    demoStepIndex,
    goToDemoStep,
    isDemoActive,
    isDemoTarget,
    restartDemo,
    stopDemo,
    toggleDemoPlayback,
  } = useDemoWalkthroughController({
    busy,
    data,
    loading,
    model: visibleModel,
    run,
    setCaseId,
    setNotice,
    setSearch,
    setSelection,
    setShellView,
    setTab,
    workflow,
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
      activeView={activeShellView(tab, shellView)}
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
      <main className={demoMode === "idle" ? "" : "demo-active"}>
        <div
          className={`page-heading ${isDemoTarget("overview")}`}
          data-demo-target="overview"
        >
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
              data-demo-target="run"
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
        <DemoWalkthrough
          busy={busy}
          mode={demoMode}
          onBack={() => advanceDemoStep(-1)}
          onJump={goToDemoStep}
          onNext={() => advanceDemoStep(1)}
          onRestart={restartDemo}
          onStop={stopDemo}
          onToggle={toggleDemoPlayback}
          stepIndex={demoStepIndex}
        />
        {!loading && model !== undefined && data !== null && (
          <LoadedWorkspace
            answer={answer}
            ask={ask}
            asking={asking}
            canvasGraph={canvasGraph}
            caseId={caseId}
            curationProjection={curationProjection}
            curationStats={curationStats}
            data={data}
            demoMode={demoMode}
            displayModel={visibleModel ?? model}
            events={events}
            handleCurationAction={handleCurationAction}
            handleUndoCuration={handleUndoCuration}
            isDemoActive={isDemoActive}
            isDemoTarget={isDemoTarget}
            model={model}
            onAbout={() => setInfo(true)}
            onExport={exportModel}
            onGraphSelect={(selected) => {
              setSelection(selected);
              setCaseId(undefined);
              setShellView("inspector");
            }}
            onRefreshSettings={() => setSettingsRefresh((x) => x + 1)}
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
            setShellView={setShellView}
            setTab={setTab}
            settings={settings}
            settingsError={settingsError}
            settingsLoading={settingsLoading}
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

function DemoWalkthrough({
  busy,
  mode,
  onBack,
  onJump,
  onNext,
  onRestart,
  onStop,
  onToggle,
  stepIndex,
}: {
  busy: boolean;
  mode: DemoPlaybackState;
  onBack: () => void;
  onJump: (index: number) => void;
  onNext: () => void;
  onRestart: () => void;
  onStop: () => void;
  onToggle: () => void;
  stepIndex: number;
}) {
  const step = demoWalkthroughSteps[stepIndex] ?? firstDemoWalkthroughStep;
  const running = mode === "playing";
  const toggleLabel = playbackButtonLabel(mode);
  return (
    <section
      aria-label="Demo auto-play walkthrough"
      className={`demo-walkthrough ${mode === "idle" ? "collapsed" : ""} ${
        mode !== "idle" && step.target === "run" ? "is-demo-focus" : ""
      }`}
      data-demo-target="run"
    >
      <div className="demo-walkthrough__control">
        <span className="demo-walkthrough__icon">
          <MonitorPlay size={18} />
        </span>
        <div>
          <span className="section-kicker">GUIDED DEMO</span>
          <h2>Auto-play walkthrough</h2>
        </div>
        <button
          aria-label={`${toggleLabel} walkthrough`}
          className="button primary"
          disabled={busy}
          onClick={onToggle}
          type="button"
        >
          {running ? (
            <Pause size={15} />
          ) : (
            <Play fill="currentColor" size={14} />
          )}
          {toggleLabel}
        </button>
        <button
          aria-label="Restart walkthrough"
          className="icon-button"
          onClick={onRestart}
          type="button"
        >
          <RotateCcw size={17} />
        </button>
        <button
          aria-label="Stop walkthrough"
          className="icon-button"
          disabled={mode === "idle"}
          onClick={onStop}
          type="button"
        >
          <Square size={15} />
        </button>
      </div>
      {mode === "idle" ? null : (
        <div aria-live="polite" className="demo-walkthrough__stage">
          <div className="demo-walkthrough__annotation">
            <span>{demoStepLabel(stepIndex)}</span>
            <div>
              <strong>{step.title}</strong>
              <p>{step.detail}</p>
            </div>
          </div>
          <div className="demo-walkthrough__nav">
            <button
              aria-label="Previous walkthrough step"
              disabled={stepIndex === 0}
              onClick={onBack}
              type="button"
            >
              <ChevronLeft size={15} />
            </button>
            <div className="demo-beats">
              {demoWalkthroughSteps.map((item, index) => (
                <button
                  aria-current={index === stepIndex ? "step" : undefined}
                  className={index === stepIndex ? "current" : ""}
                  key={item.id}
                  onClick={() => onJump(index)}
                  type="button"
                >
                  <i />
                  <span>{item.label}</span>
                </button>
              ))}
            </div>
            <button
              aria-label="Next walkthrough step"
              disabled={stepIndex === demoWalkthroughSteps.length - 1}
              onClick={onNext}
              type="button"
            >
              <ChevronRight size={15} />
            </button>
          </div>
        </div>
      )}
    </section>
  );
}

function playbackButtonLabel(mode: DemoPlaybackState) {
  if (mode === "idle") {
    return "Start";
  }
  if (mode === "playing") {
    return "Pause";
  }
  return "Resume";
}

function ProcessCanvasPanel({
  canvasGraph,
  curationStats,
  focusClass,
  selection,
  setCaseId,
  setSelection,
  setShellView,
}: {
  canvasGraph: ReturnType<typeof legacyProcessToGraphView> | undefined;
  curationStats: ReturnType<typeof curationSummary>;
  focusClass: string;
  selection: Selection | undefined;
  setCaseId: (value: string | undefined) => void;
  setSelection: (value: Selection | undefined) => void;
  setShellView: Dispatch<SetStateAction<AppShellView>>;
}) {
  return (
    <>
      <div className={`graph-hint ${focusClass}`} data-demo-target="graph">
        <span className="tiny-dot" />
        Discovered from observed activity
        <span>
          {curationStats.active
            ? graphCurationHint(curationStats)
            : "Click a step or connection to see its evidence"}
        </span>
      </div>
      <div className={`graph-canvas ${focusClass}`} data-demo-target="graph">
        {canvasGraph ? (
          <WorkflowCanvas
            graph={canvasGraph}
            onSelectionChange={(nextSelection) => {
              const next = legacySelectionFromCanvas(nextSelection);
              if (next) {
                setSelection(next);
                setCaseId(undefined);
                setShellView("inspector");
              }
            }}
            selection={canvasSelectionFromLegacy(selection)}
          />
        ) : null}
      </div>
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
  canvasGraph: ReturnType<typeof legacyProcessToGraphView> | undefined;
  caseId: string | undefined;
  curationProjection: ReturnType<typeof applyCurationEdits> | undefined;
  curationStats: ReturnType<typeof curationSummary>;
  data: Snapshot;
  demoMode: DemoPlaybackState;
  displayModel: ProcessModel;
  events: ActivityEvent[];
  handleCurationAction: (
    action: CurationAction,
    target: CurationTarget
  ) => void;
  handleUndoCuration: () => void;
  isDemoActive: (target: DemoTarget) => boolean;
  isDemoTarget: (target: DemoTarget) => string;
  model: ProcessModel;
  onAbout: () => void;
  onExport: () => void;
  onGraphSelect: (selection: Selection) => void;
  onRefreshSettings: () => void;
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
  setShellView: Dispatch<SetStateAction<AppShellView>>;
  setTab: (value: string) => void;
  settings: WorkspaceSettings | null;
  settingsError: string;
  settingsLoading: boolean;
  tab: string;
  workflow: WorkflowId;
  workspace: string;
}

function LoadedWorkspace(props: LoadedWorkspaceProps) {
  return (
    <>
      <WorkspaceStats
        focusClass={props.isDemoTarget("overview")}
        model={props.model}
      />
      {props.tab === "settings" ? (
        <SettingsPanel
          data={props.data}
          onAbout={props.onAbout}
          onExport={props.onExport}
          onRefreshSettings={props.onRefreshSettings}
          onReload={props.onReload}
          settings={props.settings}
          settingsError={props.settingsError}
          settingsLoading={props.settingsLoading}
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

function WorkspaceStats({
  focusClass,
  model,
}: {
  focusClass: string;
  model: ProcessModel;
}) {
  return (
    <div className={`stats-row ${focusClass}`} data-demo-target="overview">
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
              highlighted={props.isDemoActive("variants")}
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
          highlighted={props.isDemoActive("inspector")}
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
      <ProcessCanvasPanel
        canvasGraph={props.canvasGraph}
        curationStats={props.curationStats}
        focusClass={props.isDemoTarget("graph")}
        selection={props.selection}
        setCaseId={props.setCaseId}
        setSelection={props.setSelection}
        setShellView={props.setShellView}
      />
      <CurationStatusBar
        onUndo={props.handleUndoCuration}
        stats={props.curationStats}
      />
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
  isDemoActive,
  setCaseId,
  setQuestion,
  setSelection,
  setTab,
}: LoadedWorkspaceProps) {
  return (
    <div className="bottom-grid">
      <RecentObservations
        data={data}
        highlighted={isDemoActive("conversation")}
        setCaseId={setCaseId}
        setSelection={setSelection}
        setTab={setTab}
      />
      <AssistantPanel
        answer={answer}
        ask={ask}
        asking={asking}
        highlighted={isDemoActive("assistant")}
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
  highlighted,
  setCaseId,
  setSelection,
  setTab,
}: {
  data: Snapshot;
  highlighted: boolean;
  setCaseId: (value: string | undefined) => void;
  setSelection: (value: Selection | undefined) => void;
  setTab: (value: string) => void;
}) {
  return (
    <section
      className={`recent-card ${highlighted ? "is-demo-focus" : ""}`}
      data-demo-target="conversation"
    >
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
  highlighted: boolean;
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
  highlighted,
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
      className={highlighted ? "is-demo-focus" : ""}
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
  onExport,
  onReload,
  onRefreshSettings,
  settings,
  settingsError,
  settingsLoading,
}: {
  data: Snapshot;
  workflow: WorkflowId;
  workspace: string;
  onAbout: () => void;
  onExport: () => void;
  onReload: () => void;
  onRefreshSettings: () => void;
  settings: WorkspaceSettings | null;
  settingsError: string;
  settingsLoading: boolean;
}) {
  const workspaceLabel = workspace === "demo" ? "Acme Studio" : workspace;
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
      <div className="settings-grid">
        <article>
          <span>Workspace</span>
          <strong>{workspaceLabel}</strong>
          <small>
            {settings?.slack.workspaceId
              ? `Slack ${settings.slack.workspaceId}`
              : "Demo scope"}{" "}
            · Slack auth gated
          </small>
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
          <span>Slack events</span>
          <strong>{settings?.slack.status ?? "checking"}</strong>
          <small>
            {settings?.slack.channel
              ? `Channel ${settings.slack.channel}`
              : "No channel scope configured"}
          </small>
        </article>
        <article>
          <span>Coordinator</span>
          <strong>{settings?.channelCoordinator ?? "checking"}</strong>
          <small>Durable Object schedule and stream coordination</small>
        </article>
        <article>
          <span>Release</span>
          <strong>{shortSha(settings?.releaseSha)}</strong>
          <small>
            {settings?.generatedAt
              ? `Observed ${time(settings.generatedAt)}`
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
        {settingsError ? (
          <div className="settings-warning" role="alert">
            <ShieldCheck size={16} />
            {settingsError}
          </div>
        ) : null}
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
          {!settings && (
            <article>
              <span>Configuration</span>
              <strong>{settingsLoading ? "Loading" : "Unavailable"}</strong>
              <small>Runtime deployment metadata has not loaded yet.</small>
            </article>
          )}
        </div>
      </div>
      <div className="settings-actions">
        <button
          className="button secondary"
          disabled={settingsLoading}
          onClick={onRefreshSettings}
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
          Export model
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
          <ExternalLink size={14} />
          Deploy workflow
        </button>
        <button className="button secondary" onClick={onAbout} type="button">
          About this demo <ArrowUpRight size={14} />
        </button>
      </div>
    </section>
  );
}

function shortSha(value: string | undefined) {
  if (!value || value === "local") {
    return "local";
  }
  return value.slice(0, 7);
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
  highlighted: boolean;
  question: string;
  setCaseId: (value: string | undefined) => void;
  setQuestion: (value: string) => void;
  setSelection: (value: Selection | undefined) => void;
  setTab: (value: string) => void;
}
function AssistantPanel({
  answer,
  asking,
  highlighted,
  question,
  ask,
  setQuestion,
  setTab,
  setSelection,
  setCaseId,
}: AssistantPanelProps) {
  return (
    <section
      className={`assistant-card ${highlighted ? "is-demo-focus" : ""}`}
      data-demo-target="assistant"
    >
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
  highlighted: boolean;
  model: Snapshot["model"];
  setCaseId: (value: string | undefined) => void;
  setSelection: (value: Selection | undefined) => void;
  setTab: (value: string) => void;
}
function VariantsPanel({
  highlighted,
  model,
  setSelection,
  setCaseId,
  setTab,
}: VariantsPanelProps) {
  return (
    <div
      className={`variants-panel ${highlighted ? "is-demo-focus" : ""}`}
      data-demo-target="variants"
    >
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
