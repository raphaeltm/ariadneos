import { AccountMenu } from "./auth-gate.tsx";
import "@xyflow/react/dist/style.css";
import {
  Activity,
  ArrowDownToLine,
  ArrowRight,
  ArrowUpRight,
  Check,
  ChevronDown,
  ChevronRight,
  CircleHelp,
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
import { useEffect, useRef, useState } from "react";
import {
  type ActivityEvent,
  duration,
  type Snapshot,
  type WorkflowId,
  workflows,
} from "../shared/process.ts";
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
export default function App() {
  const [workflow, setWorkflow] = useState<WorkflowId>("vendor");
  const [data, setData] = useState<Snapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const [tab, setTab] = useState("map");
  const [selection, setSelection] = useState<Selection>();
  const [caseId, setCaseId] = useState<string>();
  const [search, setSearch] = useState("");
  const [info, setInfo] = useState(false);
  const [question, setQuestion] = useState("");
  const [answer, setAnswer] = useState<Answer>();
  const [asking, setAsking] = useState(false);
  const [refresh, setRefresh] = useState(0);
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
  const { selectedNode, selectedEdge, evidenceIds } = selectionEvidence(
    model,
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
  function chooseWorkflow(id: WorkflowId) {
    setWorkflow(id);
    setTab("map");
    setNotice("");
  }
  return (
    <div className="app-shell">
      <aside className="sidebar">
        <a aria-label="AriadneOS home" className="brand" href="/">
          <span className="brand-mark">
            A<span />
          </span>
          <span>
            Ariadne<span className="brand-os">OS</span>
          </span>
        </a>
        <button
          className="workspace"
          onClick={() => setInfo(true)}
          type="button"
        >
          <span className="workspace-icon">A</span>
          <span>
            Acme Studio<small>Demo workspace</small>
          </span>
          <ChevronDown size={15} />
        </button>
        <div className="nav-caption">WORKSPACE</div>
        <button
          className={`nav-item ${tab === "events" ? "" : "active"}`}
          onClick={() => setTab("map")}
          type="button"
        >
          <Waypoints size={18} />
          Process explorer
          <span className="nav-dot" />
        </button>
        <button
          className={`nav-item ${tab === "events" ? "active" : ""}`}
          onClick={() => {
            setSelection(undefined);
            setCaseId(undefined);
            setTab("events");
          }}
          type="button"
        >
          <Activity size={18} />
          Event stream
        </button>
        <button
          className="nav-item"
          onClick={() => setInfo(true)}
          type="button"
        >
          <Layers3 size={18} />
          Sources<span className="count-pill">1</span>
        </button>
        <div className="nav-caption workflow-caption">
          DISCOVERED PROCESSES <span>3</span>
        </div>
        <div className="workflow-links">
          {workflows.map((w, i) => (
            <button
              className={`workflow-link ${workflow === w.id ? "current" : ""}`}
              key={w.id}
              onClick={() => chooseWorkflow(w.id)}
              type="button"
            >
              <span className={`workflow-dot dot-${i}`} />
              {w.name}
            </button>
          ))}
        </div>
        <div className="sidebar-bottom">
          <div className="demo-note">
            <span className="demo-orbit">
              <Sparkles size={19} />
            </span>
            <strong>A little work. A bigger picture.</strong>
            <p>Simulate activity and watch the hidden process emerge.</p>
            <button
              disabled={busy || loading || data?.remainingRuns === 0}
              onClick={run}
              type="button"
            >
              Run a simulation <ArrowUpRight size={15} />
            </button>
          </div>
          <button
            className="help-link"
            onClick={() => setInfo(true)}
            type="button"
          >
            <CircleHelp size={17} />
            About this demo
            <ArrowUpRight size={14} />
          </button>
        </div>
      </aside>
      <div className="main-shell">
        <header className="topbar">
          <div className="breadcrumbs">
            Workspace <ChevronRight size={13} />
            <span>Process explorer</span>
          </div>
          <div className="topbar-right">
            <span className="live-label">
              <span className="online-dot" />
              Demo environment
            </span>
            <button
              aria-label="About AriadneOS"
              className="icon-button"
              onClick={() => setInfo(true)}
              type="button"
            >
              <CircleHelp size={18} />
            </button>
            <AccountMenu />
          </div>
        </header>
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
            <>
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
              <section className="explorer">
                <div className="explorer-header">
                  <div className="process-title">
                    <span className="process-icon">
                      <GitBranch size={20} />
                    </span>
                    <div>
                      <h2>{data.workflow.name}</h2>
                      <p>{data.workflow.description}</p>
                    </div>
                  </div>
                  <span className="source-chip">
                    <span className="online-dot" />
                    Synthetic observations
                  </span>
                </div>
                <div className="explorer-toolbar">
                  <div className="tabs">
                    {(
                      [
                        ["map", "Process map", Waypoints],
                        ["variants", "Variants", GitBranch],
                        ["events", "Event log", Activity],
                      ] as const
                    ).map(([id, label, Icon]) => (
                      <button
                        className={tab === id ? "selected" : ""}
                        key={String(id)}
                        onClick={() => setTab(String(id))}
                        type="button"
                      >
                        <Icon size={15} />
                        <span>{String(label)}</span>
                        {id === "variants" && (
                          <span className="tab-count">
                            {model.stats.variants}
                          </span>
                        )}
                      </button>
                    ))}
                  </div>
                  <span className="observation-range">
                    {model.stats.cases} completed cases <span>·</span>{" "}
                    {Math.round(model.stats.dominantShare * 100)}% follow the
                    main path
                  </span>
                </div>
                <div className="explorer-body">
                  <div className="main-panel">
                    {tab === "map" && (
                      <>
                        <div className="graph-hint">
                          <span className="tiny-dot" />
                          Discovered from observed activity
                          <span>
                            Click a step or connection to see its evidence
                          </span>
                        </div>
                        <div className="graph-canvas">
                          <ProcessGraph
                            model={model}
                            onSelect={(s) => {
                              setSelection(s);
                              setCaseId(undefined);
                            }}
                            selected={selection?.id}
                          />
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
                          <span className="legend-right">
                            Count · transition probability
                          </span>
                        </div>
                      </>
                    )}
                    {tab === "variants" && (
                      <VariantsPanel
                        model={model}
                        setCaseId={setCaseId}
                        setSelection={setSelection}
                        setTab={setTab}
                      />
                    )}
                    {tab === "events" && (
                      <div className="events-panel">
                        <div className="event-controls">
                          <label>
                            <Search size={16} />
                            <input
                              onChange={(e) => setSearch(e.target.value)}
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
                    )}
                  </div>
                  <Inspector
                    events={events}
                    model={model}
                    selectedEdge={selectedEdge}
                    selectedNode={selectedNode}
                    selection={selection}
                    setCaseId={setCaseId}
                    setSelection={setSelection}
                    setTab={setTab}
                    workflow={workflow}
                  />
                </div>
              </section>
              <div className="bottom-grid">
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
              <footer>
                <span>
                  <span className="online-dot" />
                  Observed. Connected. Understood.
                </span>
                <span>
                  AriadneOS preview <span>·</span> {data.remainingRuns}{" "}
                  simulation runs left
                </span>
              </footer>
            </>
          )}
        </main>
      </div>
      {info ? <AboutDialog onClose={() => setInfo(false)} /> : null}
    </div>
  );
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
  return (
    <aside className="inspector">
      {selection ? (
        <>
          <div className="inspector-label">
            OBSERVATION EVIDENCE
            <button
              aria-label="Clear selection"
              onClick={() => setSelection(undefined)}
              type="button"
            >
              <X size={16} />
            </button>
          </div>
          <span className="insight-icon">
            <Waypoints size={21} />
          </span>
          <h3>
            {selectedNode?.label ??
              `${selectedEdge?.source} → ${selectedEdge?.target}`}
          </h3>
          <p>
            {selectedNode
              ? `${selectedNode.count} observations, across ${selectedNode.actors.length} actors.`
              : `This transition appears ${selectedEdge?.count} times in ${selectedEdge?.cases} distinct cases.`}
          </p>
          {selectedEdge !== undefined && (
            <div className="evidence-metrics">
              <div>
                <strong>{Math.round(selectedEdge.probability * 100)}%</strong>
                <span>of next transitions</span>
              </div>
              <div>
                <strong>{duration(selectedEdge.medianMinutes)}</strong>
                <span>median elapsed time</span>
              </div>
            </div>
          )}
          {selectedNode !== undefined && (
            <div className="actor-pills">
              {selectedNode.actors.map((a) => (
                <span key={a}>
                  <i>{initials(a)}</i>
                  {a}
                </span>
              ))}
            </div>
          )}
          <button
            className="text-link"
            onClick={() => {
              setCaseId(undefined);
              setTab("events");
            }}
            type="button"
          >
            Inspect {events.length} source events <ArrowRight size={14} />
          </button>
          <div className="evidence-preview">
            {events.slice(0, 3).map((e) => (
              <div key={e.id}>
                <span className="avatar tiny">{initials(e.actor)}</span>
                <div>
                  <strong>{e.actor}</strong>
                  <p>{e.action}</p>
                  <button
                    onClick={() => {
                      setSelection(undefined);
                      setCaseId(e.caseId);
                      setTab("events");
                    }}
                    type="button"
                  >
                    {e.caseId}
                    <ArrowUpRight size={11} />
                  </button>
                </div>
              </div>
            ))}
          </div>
        </>
      ) : (
        <>
          <div className="inspector-label">
            <Sparkles size={14} />
            PROCESS AT A GLANCE
          </div>
          <span className="insight-icon">
            <GitBranch size={22} />
          </span>
          <h3>
            One process.
            <br />A few different journeys.
          </h3>
          <p>
            <strong>{Math.round(model.stats.dominantShare * 100)}%</strong> of
            cases follow the most common path. The rest reveal how your team
            handles exceptions.
          </p>
          <div className="main-path">
            {model.variants[0]?.path.map((step, i) => (
              <div key={model.variants[0]?.path.slice(0, i + 1).join(" → ")}>
                <span className="path-marker">
                  {i === (model.variants[0]?.path.length ?? 0) - 1 ? (
                    <Check size={10} />
                  ) : (
                    i + 1
                  )}
                </span>
                {step}
              </div>
            ))}
          </div>
          <button
            className="text-link"
            onClick={() => setTab("variants")}
            type="button"
          >
            Explore all {model.stats.variants} variants <ArrowRight size={14} />
          </button>
        </>
      )}
      <div className="context-callout">
        <span>
          <Layers3 size={15} />A traceable process
        </span>
        <p>
          Every connection comes from real event records in this simulation.
          Nothing in this map was drawn by hand.
        </p>
        <button
          onClick={() =>
            window.open(
              `/api/context?workflow=${workflow}`,
              "_blank",
              "noopener,noreferrer"
            )
          }
          type="button"
        >
          View agent context <ArrowUpRight size={13} />
        </button>
      </div>
    </aside>
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
