import { useEffect, useState, useRef } from "react";
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
import {
  workflows,
  duration,
  type Snapshot,
  type WorkflowId,
  type ActivityEvent,
} from "../shared/process";
import ProcessGraph from "./ProcessGraph";
import { AccountMenu } from "./AuthGate";
type Selection = { kind: "node" | "edge"; id: string };
type Answer = {
  answer: string;
  mode: "ai" | "summary";
  notice?: string;
  evidence: string[];
};
async function api<T>(path: string, body?: unknown): Promise<T> {
  const response = await fetch(
    path,
    body
      ? {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        }
      : undefined,
  );
  const json = (await response.json()) as T & { error?: string };
  if (!response.ok) throw new Error(json.error ?? "Unable to reach AriadneOS.");
  return json;
}
const initials = (name: string) =>
  name
    .split(" ")
    .map((n) => n[0])
    .join("");
const time = (date: string) =>
  new Date(date).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
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
        if (active) setData(d);
      })
      .catch((e) => {
        if (active) setError(e.message);
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [workflow, refresh]);
  useEffect(() => {
    if (!info) return;
    const previous = document.activeElement as HTMLElement | null;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setInfo(false);
      if (event.key === "Tab") {
        const items = document.querySelectorAll<HTMLElement>(
          ".about-modal button",
        );
        const first = items[0],
          last = items[items.length - 1];
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last?.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first?.focus();
        }
      }
    };
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
      previous?.focus();
    };
  }, [info]);
  async function run() {
    setBusy(true);
    setError("");
    try {
      const result = await api<{ addedCases: number; addedEvents: number }>(
        "/api/simulate",
        { workflow },
      );
      setNotice(
        `Observed ${result.addedEvents} new events across ${result.addedCases} cases. Process model updated.`,
      );
      setRefresh((x) => x + 1);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function ask(text = question) {
    if (!text.trim() || asking) return;
    setQuestion(text);
    setAsking(true);
    setAnswer(undefined);
    try {
      const result = await api<Answer>("/api/ask", {
        workflow,
        question: text,
      });
      if (currentWorkflow.current === workflow) setAnswer(result);
    } catch (e) {
      if (currentWorkflow.current !== workflow) return;
      setAnswer({
        answer: (e as Error).message,
        mode: "summary",
        notice: "Request failed. Try again.",
        evidence: [],
      });
    } finally {
      setAsking(false);
    }
  }
  function exportModel() {
    if (!data) return;
    const url = URL.createObjectURL(
      new Blob([JSON.stringify(data, null, 2)], { type: "application/json" }),
    );
    const a = document.createElement("a");
    a.href = url;
    a.download = `ariadneos-${workflow}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }
  const model = data?.model;
  const selectedNode = model?.nodes.find(
    (n) => selection?.kind === "node" && n.id === selection.id,
  );
  const selectedEdge = model?.edges.find(
    (e) => selection?.kind === "edge" && e.id === selection.id,
  );
  const evidenceIds = new Set(
    selectedEdge?.evidence.flatMap((e) => [e.from, e.to]) ?? [],
  );
  const events = (data?.events ?? [])
    .filter(
      (e) =>
        (!caseId || e.caseId === caseId) &&
        (!selectedNode || e.action === selectedNode.id) &&
        (!selectedEdge || evidenceIds.has(e.id)) &&
        (!search ||
          `${e.caseId} ${e.actor} ${e.action} ${e.artifact}`
            .toLowerCase()
            .includes(search.toLowerCase())),
    )
    .sort((a, b) => b.timestamp.localeCompare(a.timestamp));
  function chooseWorkflow(id: WorkflowId) {
    setWorkflow(id);
    setTab("map");
    setNotice("");
  }
  return (
    <div className="app-shell">
      <aside className="sidebar">
        <a className="brand" href="/" aria-label="AriadneOS home">
          <span className="brand-mark">
            A<span />
          </span>
          <span>
            Ariadne<span className="brand-os">OS</span>
          </span>
        </a>
        <button className="workspace" onClick={() => setInfo(true)}>
          <span className="workspace-icon">A</span>
          <span>
            Acme Studio<small>Demo workspace</small>
          </span>
          <ChevronDown size={15} />
        </button>
        <div className="nav-caption">WORKSPACE</div>
        <button
          className={`nav-item ${tab !== "events" ? "active" : ""}`}
          onClick={() => setTab("map")}
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
        >
          <Activity size={18} />
          Event stream
        </button>
        <button className="nav-item" onClick={() => setInfo(true)}>
          <Layers3 size={18} />
          Sources<span className="count-pill">1</span>
        </button>
        <div className="nav-caption workflow-caption">
          DISCOVERED PROCESSES <span>3</span>
        </div>
        <div className="workflow-links">
          {workflows.map((w, i) => (
            <button
              key={w.id}
              className={`workflow-link ${workflow === w.id ? "current" : ""}`}
              onClick={() => chooseWorkflow(w.id)}
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
              onClick={run}
              disabled={busy || loading || data?.remainingRuns === 0}
            >
              Run a simulation <ArrowUpRight size={15} />
            </button>
          </div>
          <button className="help-link" onClick={() => setInfo(true)}>
            <CircleHelp size={17} />
            About this demo
            <ArrowUpRight size={14} />
          </button>
          <AccountMenu />
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
              className="icon-button"
              onClick={() => setInfo(true)}
              aria-label="About AriadneOS"
            >
              <CircleHelp size={18} />
            </button>
            <span className="avatar small">AS</span>
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
                onClick={exportModel}
                disabled={!data || loading}
              >
                <ArrowDownToLine size={16} />
                Export model
              </button>
              <button
                className="button primary"
                onClick={run}
                disabled={busy || loading || data?.remainingRuns === 0}
              >
                {busy ? (
                  <LoaderCircle size={16} className="spin" />
                ) : (
                  <Play size={14} fill="currentColor" />
                )}
                {busy ? "Observing…" : "Simulate activity"}
              </button>
            </div>
          </div>
          {error && (
            <div className="banner error" role="alert">
              {error}
              <button onClick={() => setRefresh((x) => x + 1)}>Retry</button>
            </div>
          )}
          {notice && (
            <div className="banner success" role="status">
              <Check size={16} />
              {notice}
              <button
                aria-label="Dismiss notification"
                onClick={() => setNotice("")}
              >
                <X size={14} />
              </button>
            </div>
          )}
          {loading ? (
            <div className="loading-state">
              <LoaderCircle className="spin" />
              <p>Connecting the observations…</p>
            </div>
          ) : model && data ? (
            <>
              <div className="stats-row">
                <Stat
                  label="Observed events"
                  value={model.stats.events.toLocaleString()}
                  sub="Every action, accounted for"
                  icon={<Activity size={17} />}
                />
                <Stat
                  label="Process cases"
                  value={String(model.stats.cases)}
                  sub="Individual workflow journeys"
                  icon={<Layers3 size={17} />}
                />
                <Stat
                  label="Discovered variants"
                  value={String(model.stats.variants).padStart(2, "0")}
                  sub="Different paths through the work"
                  icon={<GitBranch size={17} />}
                />
                <Stat
                  label="Median cycle time"
                  value={duration(model.stats.medianMinutes)}
                  sub="First observation to last"
                  icon={<Clock3 size={17} />}
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
                    {[
                      ["map", "Process map", Waypoints],
                      ["variants", "Variants", GitBranch],
                      ["events", "Event log", Activity],
                    ].map(([id, label, Icon]) => (
                      <button
                        key={String(id)}
                        className={tab === id ? "selected" : ""}
                        onClick={() => setTab(String(id))}
                      >
                        {typeof Icon !== "string" && <Icon size={15} />}
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
                    {tab === "map" ? (
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
                            selected={selection?.id}
                            onSelect={(s) => {
                              setSelection(s);
                              setCaseId(undefined);
                            }}
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
                    ) : tab === "variants" ? (
                      <div className="variants-panel">
                        <div className="section-kicker">
                          SAME WORK. DIFFERENT PATHS.
                        </div>
                        <h3>The ways this process unfolds</h3>
                        <p>
                          Sequences reconstructed from complete case histories.
                        </p>
                        {model.variants.map((v, i) => (
                          <button
                            className="variant-card"
                            key={v.path.join()}
                            onClick={() => {
                              setSelection(undefined);
                              setCaseId(v.caseIds[0]);
                              setTab("events");
                            }}
                          >
                            <div className="variant-head">
                              <span>
                                Variant {String(i + 1).padStart(2, "0")}
                                {i === 0 && <em>Most common</em>}
                              </span>
                              <strong>
                                {v.count} cases ·{" "}
                                {Math.round(
                                  (v.count / model.stats.cases) * 100,
                                )}
                                %
                              </strong>
                            </div>
                            <div className="variant-path">
                              {v.path.map((p, j) => (
                                <span key={j}>
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
                    ) : (
                      <div className="events-panel">
                        <div className="event-controls">
                          <label>
                            <Search size={16} />
                            <input
                              placeholder="Search events, actors, cases…"
                              value={search}
                              onChange={(e) => setSearch(e.target.value)}
                            />
                          </label>
                          {(selection || caseId) && (
                            <button
                              onClick={() => {
                                setSelection(undefined);
                                setCaseId(undefined);
                              }}
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
                  <aside className="inspector">
                    {selection ? (
                      <>
                        <div className="inspector-label">
                          OBSERVATION EVIDENCE
                          <button
                            aria-label="Clear selection"
                            onClick={() => setSelection(undefined)}
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
                        {selectedEdge && (
                          <div className="evidence-metrics">
                            <div>
                              <strong>
                                {Math.round(selectedEdge.probability * 100)}%
                              </strong>
                              <span>of next transitions</span>
                            </div>
                            <div>
                              <strong>
                                {duration(selectedEdge.medianMinutes)}
                              </strong>
                              <span>median elapsed time</span>
                            </div>
                          </div>
                        )}
                        {selectedNode && (
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
                        >
                          Inspect {events.length} source events{" "}
                          <ArrowRight size={14} />
                        </button>
                        <div className="evidence-preview">
                          {events.slice(0, 3).map((e) => (
                            <div key={e.id}>
                              <span className="avatar tiny">
                                {initials(e.actor)}
                              </span>
                              <div>
                                <strong>{e.actor}</strong>
                                <p>{e.action}</p>
                                <button
                                  onClick={() => {
                                    setSelection(undefined);
                                    setCaseId(e.caseId);
                                    setTab("events");
                                  }}
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
                          <strong>
                            {Math.round(model.stats.dominantShare * 100)}%
                          </strong>{" "}
                          of cases follow the most common path. The rest reveal
                          how your team handles exceptions.
                        </p>
                        <div className="main-path">
                          {model.variants[0]?.path.map((step, i) => (
                            <div key={i}>
                              <span className="path-marker">
                                {i === model.variants[0].path.length - 1 ? (
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
                        >
                          Explore all {model.stats.variants} variants{" "}
                          <ArrowRight size={14} />
                        </button>
                      </>
                    )}
                    <div className="context-callout">
                      <span>
                        <Layers3 size={15} />A traceable process
                      </span>
                      <p>
                        Every connection comes from real event records in this
                        simulation. Nothing in this map was drawn by hand.
                      </p>
                      <button
                        onClick={() =>
                          window.open(
                            `/api/context?workflow=${workflow}`,
                            "_blank",
                            "noopener,noreferrer",
                          )
                        }
                      >
                        View agent context <ArrowUpRight size={13} />
                      </button>
                    </div>
                  </aside>
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
                    <div className="answer" aria-live="polite">
                      <span className="answer-label">
                        {answer.mode === "ai"
                          ? "ARIADNE · WORKERS AI"
                          : "COMPUTED SUMMARY"}
                      </span>
                      {answer.notice && <small>{answer.notice}</small>}
                      <p>{answer.answer}</p>
                      <button
                        className="text-link"
                        onClick={() => {
                          setTab("events");
                          setSelection(undefined);
                          setCaseId(undefined);
                        }}
                      >
                        Inspect supporting event log <ArrowUpRight size={12} />
                      </button>
                    </div>
                  ) : (
                    <div className="suggestions">
                      <button
                        onClick={() =>
                          ask(
                            "What is the most common path, and who approves requests?",
                          )
                        }
                      >
                        What normally happens? <ArrowUpRight size={13} />
                      </button>
                      <button
                        onClick={() =>
                          ask(
                            "Which paths are unusual, and what evidence supports that?",
                          )
                        }
                      >
                        Where does the process branch?{" "}
                        <ArrowUpRight size={13} />
                      </button>
                    </div>
                  )}
                  <form
                    className="question-form"
                    onSubmit={(e) => {
                      e.preventDefault();
                      void ask();
                    }}
                  >
                    <input
                      aria-label="Ask a question about this process"
                      maxLength={400}
                      placeholder="What would you like to understand?"
                      value={question}
                      onChange={(e) => setQuestion(e.target.value)}
                      disabled={asking}
                    />
                    <button
                      aria-label="Send question"
                      disabled={asking || !question.trim()}
                    >
                      {asking ? (
                        <LoaderCircle size={17} className="spin" />
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
          ) : (
            !loading && (
              <div className="loading-state">
                <p>No observations available.</p>
                <button
                  className="button secondary"
                  onClick={() => setRefresh((x) => x + 1)}
                >
                  Reload workspace
                </button>
              </div>
            )
          )}
        </main>
      </div>
      {info && (
        <div className="modal-backdrop" onClick={() => setInfo(false)}>
          <section
            role="dialog"
            aria-modal="true"
            aria-labelledby="about-title"
            className="about-modal"
            onClick={(e) => e.stopPropagation()}
          >
            <button
              autoFocus
              aria-label="Close about dialog"
              className="modal-close"
              onClick={() => setInfo(false)}
            >
              <X size={20} />
            </button>
            <span className="insight-icon">
              <Waypoints size={24} />
            </span>
            <h2 id="about-title">A map of how work happens.</h2>
            <p>
              AriadneOS turns activity into process context for people and
              agents. This working preview uses a synthetic organization with
              three workflows.
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
              <span className="workspace-icon">N</span>
              <div>
                <strong>Notion</strong>
                <small>Not connected in this preview</small>
              </div>
            </div>
            <p>
              New simulations add six cases to your browser’s workspace, stored
              for up to 48 hours. Graphs and counts are calculated from event
              records. AI explanations use Cloudflare Workers AI when available.
            </p>
            <button className="button primary" onClick={() => setInfo(false)}>
              Explore the process <ArrowRight size={16} />
            </button>
          </section>
        </div>
      )}
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
      {!events.length ? (
        <div className="empty">No observations match these filters.</div>
      ) : (
        events.map((e) => (
          <div className="event-row" key={e.id}>
            <span
              className={`avatar ${e.role === "Compliance" ? "clay" : e.role === "Finance" ? "lavender" : ""}`}
            >
              {initials(e.actor)}
            </span>
            <div className="event-description">
              <strong>{e.actor}</strong>
              <span>
                {e.action} <i>· {e.artifact}</i>
              </span>
            </div>
            <button className="case-link" onClick={() => onCase(e.caseId)}>
              {e.caseId}
              <ArrowUpRight size={11} />
            </button>
            <time dateTime={e.timestamp}>{time(e.timestamp)}</time>
          </div>
        ))
      )}
    </div>
  );
}
