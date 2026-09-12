import {
  AlertTriangle,
  ArrowRight,
  ArrowUpRight,
  Check,
  Flag,
  GitBranch,
  Layers3,
  Link,
  MessageSquareQuote,
  ShieldAlert,
  X,
} from "lucide-react";
import { useState } from "react";
import type {
  InspectorCurationItem,
  InspectorDetails,
} from "./inspector-data.ts";

interface ProcessInspectorProps {
  details: InspectorDetails;
  onClearSelection?: () => void;
  onCuration?: (
    item: InspectorCurationItem,
    status: "confirmed" | "rejected"
  ) => Promise<void>;
  onInspectSources?: () => void;
  onOpenContext?: () => void;
}

export function ProcessInspector({
  details,
  onClearSelection,
  onCuration,
  onInspectSources,
  onOpenContext,
}: ProcessInspectorProps) {
  const [pending, setPending] = useState<string | null>(null);
  const [flagged, setFlagged] = useState<Set<string>>(new Set());
  const [error, setError] = useState("");
  const selected = details.type !== "overview";

  const curate = async (
    item: InspectorCurationItem,
    status: "confirmed" | "rejected"
  ) => {
    if (!onCuration) {
      setError("Curation endpoint is not available for this observation.");
      return;
    }
    setPending(`${status}:${item.id}`);
    setError("");
    try {
      await onCuration(item, status);
    } catch (caught) {
      setError((caught as Error).message);
    } finally {
      setPending(null);
    }
  };

  return (
    <aside className="inspector">
      <div className="inspector-label">
        {selected ? "SELECTION INSPECTOR" : "PROCESS INSPECTOR"}
        {selected && onClearSelection ? (
          <button
            aria-label="Clear selection"
            onClick={onClearSelection}
            type="button"
          >
            <X size={16} />
          </button>
        ) : null}
      </div>
      <span className="insight-icon">
        {details.type === "edge" ? (
          <GitBranch size={21} />
        ) : (
          <Layers3 size={21} />
        )}
      </span>
      <h3>{details.title}</h3>
      <p>{details.summary}</p>
      {details.badges.length ? (
        <div className="inspector-badges">
          {details.badges.map((badge) => (
            <span key={badge}>{badge}</span>
          ))}
        </div>
      ) : null}
      {details.metrics.length ? (
        <div className="evidence-metrics">
          {details.metrics.map((metric) => (
            <div key={metric.label}>
              <strong>{metric.value}</strong>
              <span>{metric.label}</span>
            </div>
          ))}
        </div>
      ) : null}
      {selected && onInspectSources ? (
        <button
          className="inspector-action text-link"
          onClick={onInspectSources}
          type="button"
        >
          Inspect {details.evidence.length} source event
          {details.evidence.length === 1 ? "" : "s"}
          <ArrowRight size={14} />
        </button>
      ) : null}
      {details.overviewPath.length ? (
        <div className="main-path">
          {details.overviewPath.map((step, index) => (
            <div key={details.overviewPath.slice(0, index + 1).join("/")}>
              <span className="path-marker">
                {index === details.overviewPath.length - 1 ? (
                  <Check size={10} />
                ) : (
                  index + 1
                )}
              </span>
              {step}
            </div>
          ))}
        </div>
      ) : null}
      {details.evidence.length ? (
        <section className="inspector-section">
          <h4>
            <MessageSquareQuote size={14} />
            Evidence
          </h4>
          <div className="evidence-preview rich">
            {details.evidence.slice(0, 5).map((entry) => (
              <div key={entry.id}>
                <span className="avatar tiny">{initials(entry.author)}</span>
                <div>
                  <strong>{entry.author}</strong>
                  <p>{entry.quote}</p>
                  <span className="evidence-meta">
                    {entry.caseId} · {formatTime(entry.timestamp)}
                  </span>
                  {entry.permalink ? (
                    <a href={entry.permalink} rel="noreferrer" target="_blank">
                      Source <ArrowUpRight size={11} />
                    </a>
                  ) : (
                    <span className="evidence-meta">No source permalink</span>
                  )}
                </div>
              </div>
            ))}
          </div>
        </section>
      ) : null}
      {details.curationItems.length ? (
        <section className="inspector-section">
          <h4>
            <Flag size={14} />
            Curation
          </h4>
          <div className="curation-list">
            {details.curationItems.slice(0, 4).map((item) => (
              <div className="curation-item" key={item.id}>
                <div>
                  <strong>{item.label}</strong>
                  <span>
                    {item.status}
                    {item.confidence === undefined
                      ? ""
                      : ` · ${Math.round(item.confidence * 100)}% confidence`}
                  </span>
                  <p>{item.reason}</p>
                </div>
                <div className="curation-actions">
                  {item.status === "proposed" ? (
                    <>
                      <button
                        aria-label={`Confirm ${item.label}`}
                        disabled={Boolean(pending)}
                        onClick={() => curate(item, "confirmed")}
                        type="button"
                      >
                        {pending === `confirmed:${item.id}` ? (
                          "..."
                        ) : (
                          <Check size={13} />
                        )}
                      </button>
                      <button
                        aria-label={`Reject ${item.label}`}
                        disabled={Boolean(pending)}
                        onClick={() => curate(item, "rejected")}
                        type="button"
                      >
                        {pending === `rejected:${item.id}` ? (
                          "..."
                        ) : (
                          <X size={13} />
                        )}
                      </button>
                    </>
                  ) : null}
                  <button
                    aria-label={`Flag ${item.label}`}
                    className={flagged.has(item.id) ? "flagged" : ""}
                    onClick={() =>
                      setFlagged((current) => new Set(current).add(item.id))
                    }
                    type="button"
                  >
                    <Flag size={13} />
                  </button>
                </div>
              </div>
            ))}
          </div>
          {error ? <p className="inspector-error">{error}</p> : null}
        </section>
      ) : null}
      {details.conformanceSections.length ? (
        <section className="inspector-section">
          <h4>
            <ShieldAlert size={14} />
            Conformance
          </h4>
          <div className="conformance-list">
            {details.conformanceSections.map((section) => (
              <div
                className={`conformance-block ${section.tone ?? "neutral"}`}
                key={section.title}
              >
                <span>
                  {section.tone === "danger" ? (
                    <AlertTriangle size={13} />
                  ) : (
                    <Link size={13} />
                  )}
                  {section.title}
                </span>
                {section.items.slice(0, 4).map((item) => (
                  <p key={item}>{item}</p>
                ))}
              </div>
            ))}
          </div>
        </section>
      ) : null}
      {onOpenContext ? (
        <div className="context-callout">
          <span>
            <Layers3 size={15} /> Traceable process
          </span>
          <p>
            Evidence and conformance data come from the selected process scope.
          </p>
          <button onClick={onOpenContext} type="button">
            View agent context <ArrowUpRight size={13} />
          </button>
        </div>
      ) : null}
    </aside>
  );
}

function initials(name: string) {
  return name
    .split(" ")
    .filter(Boolean)
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
