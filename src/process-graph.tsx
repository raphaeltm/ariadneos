import dagre from "@dagrejs/dagre";
import {
  Background,
  BaseEdge,
  Controls,
  type Edge,
  EdgeLabelRenderer,
  type EdgeProps,
  getSmoothStepPath,
  Handle,
  MarkerType,
  type Node,
  type NodeProps,
  Position,
  ReactFlow,
  type ReactFlowInstance,
} from "@xyflow/react";
import {
  Check,
  CircleDot,
  GitMerge,
  LoaderCircle,
  Scissors,
  X,
} from "lucide-react";
import {
  type KeyboardEvent as ReactKeyboardEvent,
  useId,
  useMemo,
  useRef,
  useState,
} from "react";
import type { ProcessModel } from "../shared/process.ts";
import {
  canvasShortcutInstructions,
  shortcutActionForCanvas,
} from "./components/process-canvas/graph.ts";
import type {
  CurationAction,
  CurationDecoration,
  CurationTargetKind,
} from "./curation.ts";

type ActivityNode = Node<{
  ariaLabel: string;
  count: number;
  curation?: CurationDecoration;
  label: string;
  labelId: string;
  legalActions: CurationAction[];
  mergeTargetLabel?: string;
  onCurate?: (
    action: CurationAction,
    target: { id: string; kind: CurationTargetKind }
  ) => void;
  pending: boolean;
  role: string;
  terminal: boolean;
}>;
type LegacyNodeSummary = Pick<
  ProcessModel["nodes"][number],
  "count" | "grounded" | "label" | "plane" | "role"
>;
function Activity({ data, selected }: NodeProps<ActivityNode>) {
  return (
    <div
      aria-current={selected ? "true" : undefined}
      aria-label={data.ariaLabel}
      className={`activity-node ${selected ? "selected" : ""} ${data.terminal ? "terminal" : ""} ${data.curation ? `curated ${data.curation.action}` : ""}`}
      id={legacyCanvasDomId(data.labelId)}
      role="img"
    >
      {selected && data.onCurate ? (
        <CurationToolbar
          actions={data.legalActions}
          label={data.label}
          mergeTargetLabel={data.mergeTargetLabel}
          onAction={(action) =>
            data.onCurate?.(action, { id: data.labelId, kind: "node" })
          }
          pending={data.pending}
        />
      ) : null}
      <Handle position={Position.Top} type="target" />
      <div className="node-heading">
        <span className="node-icon">
          {data.terminal ? <Check size={14} /> : <CircleDot size={14} />}
        </span>
        <span>{data.role}</span>
        <span className="node-count">{data.count}</span>
      </div>
      <strong>{data.label}</strong>
      {data.curation ? (
        <span className={`curation-badge ${data.curation.persistence}`}>
          {data.curation.persistence}
        </span>
      ) : null}
      <Handle position={Position.Bottom} type="source" />
    </div>
  );
}
type CuratedEdge = Edge<{
  ariaLabel: string;
  curation?: CurationDecoration;
  label: string;
  legalActions: CurationAction[];
  onCurate?: (
    action: CurationAction,
    target: { id: string; kind: CurationTargetKind }
  ) => void;
  pending: boolean;
}>;

const nodeTypes = { activity: Activity };
const edgeTypes = { curated: CuratedGraphEdge };
export default function ProcessGraph({
  model,
  onSelect,
  onCurate,
  curation,
  selected,
}: {
  curation?: {
    edgeDecorations: Record<string, CurationDecoration>;
    nodeDecorations: Record<string, CurationDecoration>;
  };
  model: ProcessModel;
  onCurate?: (
    action: CurationAction,
    target: { id: string; kind: CurationTargetKind }
  ) => void;
  onSelect: (value: { kind: "node" | "edge"; id: string } | undefined) => void;
  selected: string | undefined;
}) {
  const [flow, setFlow] = useState<ReactFlowInstance<ActivityNode> | null>(
    null
  );
  const [announcement, setAnnouncement] = useState(
    "Process map ready. Focus the canvas to use keyboard shortcuts."
  );
  const instructionsId = useId();
  const statusId = useId();
  const selectionHistory = useRef<Array<{ kind: "node" | "edge"; id: string }>>(
    []
  );
  const { nodes, edges } = useMemo(() => {
    const graph = new dagre.graphlib.Graph();
    graph.setGraph({
      marginx: 30,
      marginy: 25,
      nodesep: 65,
      rankdir: "TB",
      ranksep: 70,
    });
    graph.setDefaultEdgeLabel(() => ({}));
    for (const n of model.nodes) {
      graph.setNode(n.id, { height: 77, width: 200 });
    }
    for (const e of model.edges) {
      graph.setEdge(e.source, e.target);
    }
    dagre.layout(graph);
    return {
      edges: model.edges.map((e) => {
        const edgeDecoration = curation?.edgeDecorations[e.id];
        return {
          animated: selected === e.id,
          data: {
            ariaLabel: describeLegacyEdge(model, e.id),
            curation: edgeDecoration,
            label: `${e.count} · ${Math.round(e.probability * 100)}%`,
            legalActions: ["confirm", "reject", "split"],
            onCurate,
            pending: edgeDecoration?.persistence === "pending",
          },
          id: e.id,
          label: `${e.count} · ${Math.round(e.probability * 100)}%`,
          labelBgPadding: [7, 4] as [number, number],
          labelBgStyle: { fill: "#f9faf6" },
          labelStyle: { fill: "#66736b", fontSize: 11, fontWeight: 600 },
          markerEnd: {
            color: "#829687",
            height: 16,
            type: MarkerType.ArrowClosed,
            width: 16,
          },
          source: e.source,
          style: {
            stroke: edgeColor(e.id === selected, e.probability),
            strokeDasharray: e.probability < 0.35 ? "5 4" : undefined,
            strokeWidth:
              selected === e.id ? 3 : Math.max(1.3, e.probability * 2.8),
          },
          target: e.target,
          type: "curated",
        };
      }),
      nodes: model.nodes.map((n) => {
        const nodeDecoration = curation?.nodeDecorations[n.id];
        return {
          data: {
            ...n,
            ariaLabel: describeLegacyNode(n),
            curation: nodeDecoration,
            labelId: n.id,
            legalActions: legalNodeActions(model, n.id),
            mergeTargetLabel: getMergeTargetLabel(model, n.id),
            onCurate,
            pending: nodeDecoration?.persistence === "pending",
          },
          id: n.id,
          position: {
            x: graph.node(n.id).x - 100,
            y: graph.node(n.id).y - 38.5,
          },
          selected: selected === n.id,
          type: "activity",
        };
      }),
    };
  }, [curation, model, onCurate, selected]);
  const keyboardTargets = useMemo(
    () => [
      ...model.nodes.map((node) => ({
        id: node.id,
        kind: "node" as const,
        label: describeLegacyNode(node),
      })),
      ...model.edges.map((edge) => ({
        id: edge.id,
        kind: "edge" as const,
        label: describeLegacyEdge(model, edge.id),
      })),
    ],
    [model]
  );
  const activeDescendant =
    selected && model.nodes.some((node) => node.id === selected)
      ? legacyCanvasDomId(selected)
      : undefined;
  const rememberSelection = () => {
    const current = selected
      ? keyboardTargets.find((target) => target.id === selected)
      : undefined;
    if (current) {
      selectionHistory.current = [
        { id: current.id, kind: current.kind },
        ...selectionHistory.current,
      ].slice(0, 12);
    }
  };
  const selectTarget = (
    target: (typeof keyboardTargets)[number] | undefined
  ) => {
    if (!target) {
      setAnnouncement("No graph items to select.");
      return;
    }
    rememberSelection();
    onSelect({ id: target.id, kind: target.kind });
    setAnnouncement(`Selected ${target.label}.`);
  };
  const restoreSelection = () => {
    const [previous, ...rest] = selectionHistory.current;
    if (!previous) {
      setAnnouncement("No previous graph selection to restore.");
      return;
    }
    selectionHistory.current = rest;
    onSelect(previous);
    setAnnouncement("Previous graph selection restored.");
  };
  const clearSelection = () => {
    if (!selected) {
      setAnnouncement("No graph selection to clear.");
      return;
    }
    rememberSelection();
    onSelect(undefined);
    setAnnouncement("Graph selection cleared.");
  };
  const panCanvas = (x: number, y: number) => {
    if (!flow) {
      setAnnouncement("Canvas controls are still loading.");
      return;
    }
    const viewport = flow.getViewport();
    announceFlowResult(
      flow.setViewport(
        { ...viewport, x: viewport.x + x, y: viewport.y + y },
        { duration: 120 }
      ),
      setAnnouncement,
      "Canvas panned."
    );
  };
  const handleKeyDown = (event: ReactKeyboardEvent<HTMLElement>) => {
    const action = shortcutActionForCanvas(shortcutInputFromEvent(event));
    if (!action) {
      return;
    }
    event.preventDefault();
    switch (action) {
      case "clear_selection":
        clearSelection();
        return;
      case "fit_view":
        if (flow) {
          announceFlowResult(
            flow.fitView({ duration: 150, padding: 0.2 }),
            setAnnouncement,
            "Graph fit to view."
          );
        }
        return;
      case "pan_down":
        panCanvas(0, -72);
        return;
      case "pan_left":
        panCanvas(72, 0);
        return;
      case "pan_right":
        panCanvas(-72, 0);
        return;
      case "pan_up":
        panCanvas(0, 72);
        return;
      case "restore_selection":
        restoreSelection();
        return;
      case "select_first":
        selectTarget(keyboardTargets[0]);
        return;
      case "select_last":
        selectTarget(keyboardTargets.at(-1));
        return;
      case "select_next":
        selectTarget(nextLegacyTarget(keyboardTargets, selected, 1));
        return;
      case "select_previous":
        selectTarget(nextLegacyTarget(keyboardTargets, selected, -1));
        return;
      case "zoom_in":
        if (flow) {
          announceFlowResult(
            flow.zoomIn({ duration: 120 }),
            setAnnouncement,
            "Graph zoomed in."
          );
        }
        return;
      case "zoom_out":
        if (flow) {
          announceFlowResult(
            flow.zoomOut({ duration: 120 }),
            setAnnouncement,
            "Graph zoomed out."
          );
        }
        return;
      default:
        assertNever(action);
    }
  };
  return (
    <div className="graph-canvas__keyboard-layer">
      <p className="sr-only" id={instructionsId}>
        {canvasShortcutInstructions}
      </p>
      <p aria-live="polite" className="sr-only" id={statusId}>
        {announcement}
      </p>
      <ReactFlow
        aria-activedescendant={activeDescendant}
        aria-describedby={`${instructionsId} ${statusId}`}
        aria-label="Process map nodes and edges"
        edges={edges}
        edgeTypes={edgeTypes}
        fitView
        fitViewOptions={{ padding: 0.2 }}
        key={model.nodes.map((n) => n.id).join()}
        maxZoom={1.5}
        minZoom={0.3}
        nodes={nodes}
        nodesConnectable={false}
        nodesDraggable={false}
        nodeTypes={nodeTypes}
        onEdgeClick={(_, e) => {
          rememberSelection();
          onSelect({ id: e.id, kind: "edge" });
          setAnnouncement(`Selected ${describeLegacyEdge(model, e.id)}.`);
        }}
        onEdgesChange={(changes) => {
          const change = changes.find((c) => c.type === "select" && c.selected);
          if (change && "id" in change) {
            rememberSelection();
            onSelect({ id: change.id, kind: "edge" });
            setAnnouncement(
              `Selected ${describeLegacyEdge(model, change.id)}.`
            );
          }
        }}
        onInit={setFlow}
        onKeyDown={handleKeyDown}
        onNodeClick={(_, n) => {
          rememberSelection();
          onSelect({ id: n.id, kind: "node" });
          setAnnouncement(`Selected ${describeLegacyNode(n.data)}.`);
        }}
        onNodesChange={(changes) => {
          const change = changes.find((c) => c.type === "select" && c.selected);
          if (change && "id" in change) {
            const node = model.nodes.find((item) => item.id === change.id);
            rememberSelection();
            onSelect({ id: change.id, kind: "node" });
            setAnnouncement(
              `Selected ${node ? describeLegacyNode(node) : change.id}.`
            );
          }
        }}
        proOptions={{ hideAttribution: false }}
        role="application"
        tabIndex={0}
      >
        <Background color="#d9dfd5" gap={22} size={1} />
        <Controls showInteractive={false} />
      </ReactFlow>
    </div>
  );
}

function CuratedGraphEdge({
  data,
  id,
  markerEnd,
  selected,
  sourcePosition,
  sourceX,
  sourceY,
  style,
  targetPosition,
  targetX,
  targetY,
}: EdgeProps<CuratedEdge>) {
  const [edgePath, labelX, labelY] = getSmoothStepPath({
    sourcePosition,
    sourceX,
    sourceY,
    targetPosition,
    targetX,
    targetY,
  });
  return (
    <>
      <BaseEdge id={id} markerEnd={markerEnd} path={edgePath} style={style} />
      <EdgeLabelRenderer>
        <div
          aria-current={selected ? "true" : undefined}
          aria-label={data?.ariaLabel ?? id}
          className={`edge-curation-label ${selected ? "selected" : ""}`}
          id={legacyCanvasDomId(id)}
          role="img"
          style={{
            transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)`,
          }}
        >
          <span>{data?.label}</span>
          {selected && data?.onCurate ? (
            <CurationToolbar
              actions={data.legalActions}
              compact
              label={data.label}
              onAction={(action) =>
                data.onCurate?.(action, { id, kind: "edge" })
              }
              pending={data.pending}
            />
          ) : null}
        </div>
      </EdgeLabelRenderer>
    </>
  );
}

function CurationToolbar({
  actions,
  compact = false,
  label,
  mergeTargetLabel: mergeLabel,
  onAction,
  pending,
}: {
  actions: CurationAction[];
  compact?: boolean;
  label: string;
  mergeTargetLabel?: string;
  onAction: (action: CurationAction) => void;
  pending: boolean;
}) {
  if (actions.length === 0) {
    return null;
  }
  return (
    <div
      className={`curation-toolbar ${compact ? "compact" : ""} nodrag nopan`}
    >
      {actions.map((action) => (
        <button
          aria-label={`${curationLabel(action, mergeLabel)} ${label}`}
          disabled={pending}
          key={action}
          onClick={(event) => {
            event.preventDefault();
            event.stopPropagation();
            onAction(action);
          }}
          title={curationTitle(action, mergeLabel)}
          type="button"
        >
          {pending ? (
            <LoaderCircle className="spin" size={12} />
          ) : (
            iconFor(action)
          )}
        </button>
      ))}
    </div>
  );
}

function edgeColor(selected: boolean, probability: number) {
  if (selected) {
    return "#bd7b3c";
  }
  return probability < 0.35 ? "#b9b2a5" : "#66816e";
}

function describeLegacyNode(node: LegacyNodeSummary) {
  const grounded =
    node.grounded === undefined ? "" : `, ${node.grounded} grounded`;
  const plane = node.plane ? `, ${node.plane}` : "";
  return `${node.label}, ${node.role} role, ${node.count} observations${grounded}${plane}`;
}

function describeLegacyEdge(model: ProcessModel, edgeId: string) {
  const edge = model.edges.find((item) => item.id === edgeId);
  if (!edge) {
    return edgeId;
  }
  const source = model.nodes.find((node) => node.id === edge.source);
  const target = model.nodes.find((node) => node.id === edge.target);
  const probability = Math.round(edge.probability * 100);
  return `${source?.label ?? edge.source} to ${target?.label ?? edge.target}, ${edge.count} transitions, ${probability}% probability`;
}

function nextLegacyTarget<TTarget extends { id: string }>(
  targets: readonly TTarget[],
  selectedId: string | undefined,
  direction: -1 | 1
) {
  if (targets.length === 0) {
    return;
  }
  const currentIndex = targets.findIndex((target) => target.id === selectedId);
  if (currentIndex === -1) {
    return direction === 1 ? targets[0] : targets.at(-1);
  }
  const nextIndex =
    (currentIndex + direction + targets.length) % targets.length;
  return targets[nextIndex];
}

function legacyCanvasDomId(id: string) {
  return `process-map-item-${id.replaceAll(/[^A-Za-z0-9_-]/g, "-")}`;
}

function shortcutInputFromEvent(event: ReactKeyboardEvent<HTMLElement>) {
  const target = event.target instanceof HTMLElement ? event.target : undefined;
  return {
    altKey: event.altKey,
    ctrlKey: event.ctrlKey,
    key: event.key,
    metaKey: event.metaKey,
    shiftKey: event.shiftKey,
    targetIsContentEditable: target?.isContentEditable,
    targetRole: target?.getAttribute("role"),
    targetTagName: target?.tagName,
  };
}

function announceFlowResult(
  result: Promise<unknown>,
  setAnnouncement: (message: string) => void,
  successMessage: string
) {
  result
    .then(() => setAnnouncement(successMessage))
    .catch(() => setAnnouncement("Canvas command could not finish."));
}

function assertNever(value: never): never {
  throw new Error(`Unhandled graph keyboard action ${value}`);
}

function curationLabel(action: CurationAction, mergeLabel?: string) {
  if (action === "confirm") {
    return "Confirm";
  }
  if (action === "merge") {
    return mergeLabel ? `Merge into ${mergeLabel}` : "Merge";
  }
  if (action === "reject") {
    return "Reject";
  }
  return "Split";
}

function curationTitle(action: CurationAction, mergeLabel?: string) {
  if (action === "merge" && mergeLabel) {
    return `Merge with ${mergeLabel}`;
  }
  return curationLabel(action);
}

function iconFor(action: CurationAction) {
  if (action === "confirm") {
    return <Check size={13} />;
  }
  if (action === "merge") {
    return <GitMerge size={13} />;
  }
  if (action === "reject") {
    return <X size={13} />;
  }
  return <Scissors size={13} />;
}

function legalNodeActions(
  model: ProcessModel,
  nodeId: string
): CurationAction[] {
  const hasMergeTarget = Boolean(getMergeTargetLabel(model, nodeId));
  return hasMergeTarget
    ? ["confirm", "reject", "merge", "split"]
    : ["confirm", "reject", "split"];
}

function getMergeTargetLabel(model: ProcessModel, nodeId: string) {
  const neighborIds = model.edges
    .filter((edge) => edge.source === nodeId || edge.target === nodeId)
    .flatMap((edge) => [edge.source, edge.target])
    .filter((id) => id !== nodeId);
  return neighborIds
    .map((id) => model.nodes.find((node) => node.id === id))
    .filter((node): node is ProcessModel["nodes"][number] => Boolean(node))
    .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label))[0]
    ?.label;
}
