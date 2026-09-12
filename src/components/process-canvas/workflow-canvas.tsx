import "@xyflow/react/dist/style.css";
import {
  Background,
  BaseEdge,
  Controls,
  type Edge,
  EdgeLabelRenderer,
  type EdgeProps,
  getBezierPath,
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
  AlertTriangle,
  Link2,
  RotateCcw,
  ShieldCheck,
  Split,
} from "lucide-react";
import {
  type KeyboardEvent as ReactKeyboardEvent,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from "react";
import type { GraphEdge } from "../../../shared/contracts.ts";
import type { AppSelection } from "../../store.ts";
import {
  canvasKeyboardTargets,
  canvasShortcutInstructions,
  conformanceOverlaySummary,
  edgeForKeyboardTarget,
  filterCanvasGraph,
  layoutCanvasGraph,
  nextCanvasKeyboardTarget,
  selectionForConformanceIssue,
  selectionForEdge,
  selectionForNode,
  shortcutActionForCanvas,
  supportLimit,
} from "./graph.ts";
import "./process-canvas.css";
import type {
  CanvasEdgeData,
  CanvasNodeData,
  CanvasPositionCache,
  WorkflowCanvasMode,
  WorkflowCanvasProps,
} from "./types.ts";

const canvasModes = [
  ["overlay", "Overlay"],
  ["discovered", "Discovered"],
  ["designed", "Documented"],
  ["instance", "This case"],
] as const;

type WorkflowNode = Node<CanvasNodeData, "activity">;
type WorkflowEdge = Edge<CanvasEdgeData, "process">;

const nodeTypes = { activity: ActivityNode };
const edgeTypes = { process: ProcessEdge };

export function WorkflowCanvas({
  graph,
  initialMode = graph.kind === "instance" ? "instance" : "overlay",
  initialMinSupport = graph.min_support,
  onMinSupportChange,
  onModeChange,
  onSelectionChange,
  selection,
}: WorkflowCanvasProps) {
  const [mode, setMode] = useState<WorkflowCanvasMode>(initialMode);
  const [minSupport, setMinSupport] = useState(initialMinSupport);
  const [flow, setFlow] = useState<ReactFlowInstance<
    WorkflowNode,
    WorkflowEdge
  > | null>(null);
  const [announcement, setAnnouncement] = useState(
    "Workflow canvas ready. Focus the canvas to use keyboard shortcuts."
  );
  const debouncedMode = useDebouncedValue(mode, 250);
  const debouncedSupport = useDebouncedValue(minSupport, 250);
  const instructionsId = useId();
  const statusId = useId();
  const positionCache = useRef<CanvasPositionCache>({});
  const selectionHistory = useRef<
    NonNullable<WorkflowCanvasProps["selection"]>[]
  >([]);
  const visible = useMemo(
    () => filterCanvasGraph(graph, debouncedMode, debouncedSupport),
    [graph, debouncedMode, debouncedSupport]
  );
  const keyboardTargets = useMemo(
    () => canvasKeyboardTargets(visible, graph),
    [graph, visible]
  );
  const layout = useMemo(() => {
    const next = layoutCanvasGraph(visible, graph, positionCache.current);
    positionCache.current = next.positionCache;
    return next;
  }, [graph, visible]);
  const selectedId = selection?.node_id ?? selection?.edge_id;
  const activeDescendant =
    selectedId && keyboardTargets.some((target) => target.id === selectedId)
      ? canvasDomId("item", selectedId)
      : undefined;
  const edgeById = useMemo(
    () => new Map(graph.edges.map((edge) => [edge.id, edge])),
    [graph.edges]
  );
  const overlaySummary = useMemo(
    () => conformanceOverlaySummary(graph),
    [graph]
  );
  const nodes = useMemo(
    () =>
      layout.nodes.map((node) => ({
        ...node,
        selected: selectedId === node.id,
        type: "activity",
      })) satisfies WorkflowNode[],
    [layout.nodes, selectedId]
  );
  const edges = useMemo(
    () =>
      layout.edges.map((edge) => ({
        ...edge,
        animated: selectedId === edge.id,
        markerEnd: {
          color: edgeColor(edge.data, selectedId === edge.id),
          height: 16,
          type: MarkerType.ArrowClosed,
          width: 16,
        },
        selected: selectedId === edge.id,
        style: edgeStyle(edge.data, selectedId === edge.id),
        type: "process",
      })) satisfies WorkflowEdge[],
    [layout.edges, selectedId]
  );
  const { conformance } = graph;
  const maxSupport = supportLimit(graph);
  const chooseMode = (nextMode: WorkflowCanvasMode) => {
    setMode(nextMode);
    onModeChange?.(nextMode);
    setAnnouncement(`Canvas mode changed to ${modeLabel(nextMode)}.`);
  };
  const changeSupport = (value: number) => {
    setMinSupport(value);
    onMinSupportChange?.(value);
    setAnnouncement(`Minimum support changed to ${value}.`);
  };
  const rememberSelection = () => {
    if (selectionHasGraphItem(selection)) {
      selectionHistory.current = [selection, ...selectionHistory.current].slice(
        0,
        12
      );
    }
  };
  const selectKeyboardTarget = (
    target: (typeof keyboardTargets)[number] | undefined
  ) => {
    if (!target) {
      setAnnouncement("No visible graph items to select.");
      return;
    }
    rememberSelection();
    if (target.kind === "node") {
      onSelectionChange?.(selectionForNode(graph, target.id));
    } else {
      const edge = edgeForKeyboardTarget(graph, target);
      if (edge) {
        onSelectionChange?.(selectionForEdge(graph, edge));
      }
    }
    setAnnouncement(`Selected ${target.label}.`);
  };
  const restoreSelection = () => {
    const [previous, ...rest] = selectionHistory.current;
    if (!previous) {
      setAnnouncement("No previous canvas selection to restore.");
      return;
    }
    selectionHistory.current = rest;
    onSelectionChange?.(previous);
    setAnnouncement("Previous canvas selection restored.");
  };
  const clearSelection = () => {
    if (!selectionHasGraphItem(selection)) {
      setAnnouncement("No canvas selection to clear.");
      return;
    }
    rememberSelection();
    onSelectionChange?.({ workflow_id: graph.workflow_id });
    setAnnouncement("Canvas selection cleared.");
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
  const handleCanvasKeyDown = (event: ReactKeyboardEvent<HTMLElement>) => {
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
            flow.fitView({ duration: 150, padding: 0.25 }),
            setAnnouncement,
            "Canvas fit to view."
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
        selectKeyboardTarget(keyboardTargets[0]);
        return;
      case "select_last":
        selectKeyboardTarget(keyboardTargets.at(-1));
        return;
      case "select_next":
        selectKeyboardTarget(
          nextCanvasKeyboardTarget(keyboardTargets, selectedId, 1)
        );
        return;
      case "select_previous":
        selectKeyboardTarget(
          nextCanvasKeyboardTarget(keyboardTargets, selectedId, -1)
        );
        return;
      case "zoom_in":
        if (flow) {
          announceFlowResult(
            flow.zoomIn({ duration: 120 }),
            setAnnouncement,
            "Canvas zoomed in."
          );
        }
        return;
      case "zoom_out":
        if (flow) {
          announceFlowResult(
            flow.zoomOut({ duration: 120 }),
            setAnnouncement,
            "Canvas zoomed out."
          );
        }
        return;
      default:
        assertNever(action);
    }
  };
  return (
    <section
      aria-label="Workflow canvas"
      className="workflow-canvas"
      data-mode={mode}
    >
      <p className="sr-only" id={instructionsId}>
        {canvasShortcutInstructions}
      </p>
      <p aria-live="polite" className="sr-only" id={statusId}>
        {announcement}
      </p>
      <div className="workflow-canvas__toolbar">
        <fieldset className="canvas-segmented">
          <legend className="sr-only">Canvas mode</legend>
          {canvasModes.map(([id, label]) => (
            <button
              aria-pressed={mode === id}
              className={mode === id ? "is-active" : ""}
              key={id}
              onClick={() => chooseMode(id)}
              type="button"
            >
              {label}
            </button>
          ))}
        </fieldset>
        <label className="support-control">
          <span>Support {minSupport}</span>
          <input
            aria-label="Minimum support"
            max={maxSupport}
            min={1}
            onChange={(event) => changeSupport(Number(event.target.value))}
            type="range"
            value={Math.min(minSupport, maxSupport)}
          />
        </label>
      </div>
      <div className="workflow-canvas__stage">
        <ReactFlow
          aria-activedescendant={activeDescendant}
          aria-describedby={`${instructionsId} ${statusId}`}
          aria-label="Workflow graph nodes and edges"
          edges={edges}
          edgeTypes={edgeTypes}
          fitView
          fitViewOptions={{ padding: 0.25 }}
          maxZoom={1.5}
          minZoom={0.3}
          nodes={nodes}
          nodesConnectable={false}
          nodesDraggable={false}
          nodeTypes={nodeTypes}
          onEdgeClick={(_, edge) => {
            const graphEdge = edgeById.get(edge.id as GraphEdge["id"]);
            if (graphEdge) {
              rememberSelection();
              onSelectionChange?.(selectionForEdge(graph, graphEdge));
              setAnnouncement(
                `Selected ${edge.data?.ariaLabel ?? graphEdge.id}.`
              );
            }
          }}
          onInit={setFlow}
          onKeyDown={handleCanvasKeyDown}
          onNodeClick={(_, node) => {
            rememberSelection();
            onSelectionChange?.(
              selectionForNode(graph, node.id as WorkflowNode["data"]["id"])
            );
            setAnnouncement(`Selected ${node.data.ariaLabel}.`);
          }}
          panOnDrag
          proOptions={{ hideAttribution: true }}
          role="application"
          tabIndex={0}
          zoomOnScroll
        >
          <Background color="#29302f" gap={24} size={1} />
          <Controls showInteractive={false} />
        </ReactFlow>
        <div className="canvas-legend">
          <span>
            <i className="legend-swatch both" />
            Documented and observed
          </span>
          <span>
            <i className="legend-swatch discovered" />
            Discovered only
          </span>
          <span>
            <i className="legend-swatch designed" />
            Documented ghost
          </span>
          <span>
            <i className="legend-line rework" />
            Rework
          </span>
          <span>
            <i className="legend-swatch violation" />
            Violation
          </span>
          <span>
            <i className="legend-swatch deviating" />
            Role/deviant
          </span>
        </div>
      </div>
      <fieldset className="conformance-strip">
        <legend className="sr-only">Workflow conformance</legend>
        <button type="button">
          conformance{" "}
          <strong>
            {conformance?.fitness === null || conformance?.fitness === undefined
              ? "n/a"
              : `${Math.round(conformance.fitness * 100)}%`}
          </strong>
        </button>
        <button
          onClick={() =>
            selectConformanceIssue(graph, "missing", onSelectionChange)
          }
          type="button"
        >
          missing <strong>{overlaySummary.missingCount}</strong>
        </button>
        <button
          onClick={() =>
            selectConformanceIssue(graph, "extra", onSelectionChange)
          }
          type="button"
        >
          extra <strong>{overlaySummary.extraCount}</strong>
        </button>
        <button
          onClick={() =>
            selectConformanceIssue(graph, "violation", onSelectionChange)
          }
          type="button"
        >
          violations <strong>{overlaySummary.violationCount}</strong>
        </button>
        <button
          onClick={() =>
            selectConformanceIssue(graph, "role-deviation", onSelectionChange)
          }
          type="button"
        >
          role deviations <strong>{overlaySummary.roleDeviationCount}</strong>
        </button>
        <span>
          deviant paths <strong>{overlaySummary.orderBreakCount}</strong>
        </span>
        <span>{visible.nodes.length} nodes visible</span>
      </fieldset>
    </section>
  );
}

function ActivityNode({ data, selected }: NodeProps<WorkflowNode>) {
  const groundingPercent = Math.round(data.groundingRatio * 100);
  return (
    <div
      aria-current={selected ? "true" : undefined}
      aria-label={data.ariaLabel}
      className={`canvas-node plane-${data.plane} ${selected ? "selected" : ""} ${
        data.isProposed ? "is-proposed" : ""
      } severity-${data.severity} diff-${data.diffKind}`}
      id={canvasDomId("item", data.id)}
      role="img"
      title={data.annotationTitle ?? undefined}
    >
      <Handle position={Position.Left} type="target" />
      <div className="canvas-node__meta">
        <span
          className={`role-chip ${data.hasRoleDeviation ? "is-deviating" : ""}`}
        >
          {data.role}
        </span>
        {data.groundedCount > 0 ? (
          <span className="grounding-badge">
            <Link2 size={11} />
            {data.groundedCount}/{data.support || data.groundedCount}
          </span>
        ) : null}
        {data.violationCount > 0 ? (
          <span className="violation-badge">
            <AlertTriangle size={11} />
          </span>
        ) : null}
        {data.diffKind === "role-deviation" ? (
          <span className="violation-badge is-warning">
            <Split size={11} />
          </span>
        ) : null}
        <span className="support-badge">x{data.support}</span>
      </div>
      <strong>{data.label}</strong>
      {data.annotationLabel ? (
        <span className={`diff-pill severity-${data.severity}`}>
          {data.annotationLabel}
        </span>
      ) : null}
      {data.groundingRatio > 0 && data.groundingRatio < 1 ? (
        <meter
          aria-label={`${groundingPercent}% grounded`}
          className="grounding-bar"
          max={100}
          min={0}
          value={groundingPercent}
        >
          {groundingPercent}% grounded
        </meter>
      ) : null}
      {data.hasUnreconciledWork ? (
        <span className="node-footnote">
          <ShieldCheck size={11} />
          commitment pending
        </span>
      ) : null}
      <Handle position={Position.Right} type="source" />
    </div>
  );
}

function ProcessEdge(props: EdgeProps<WorkflowEdge>) {
  const { data } = props;
  const [path, labelX, labelY] = data?.isBackEdge
    ? getBezierPath({
        sourcePosition: Position.Top,
        sourceX: props.sourceX,
        sourceY: props.sourceY - 36,
        targetPosition: Position.Top,
        targetX: props.targetX,
        targetY: props.targetY - 36,
      })
    : getSmoothStepPath({
        borderRadius: 16,
        sourcePosition: props.sourcePosition,
        sourceX: props.sourceX,
        sourceY: props.sourceY,
        targetPosition: props.targetPosition,
        targetX: props.targetX,
        targetY: props.targetY,
      });
  if (!data) {
    return null;
  }
  return (
    <>
      <BaseEdge
        id={props.id}
        markerEnd={props.markerEnd}
        path={path}
        style={props.style}
      />
      <EdgeLabelRenderer>
        <div
          aria-current={props.selected ? "true" : undefined}
          aria-label={data.ariaLabel}
          className={`canvas-edge-label severity-${data.severity} ${
            props.selected ? "selected" : ""
          }`}
          id={canvasDomId("item", props.id)}
          role="img"
          style={{
            transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)`,
          }}
          title={data.tooltip}
        >
          {data.violationCount > 0 ? <AlertTriangle size={11} /> : null}
          {data.isBackEdge ? <RotateCcw size={11} /> : null}
          <span>{data.annotationLabel ?? data.label}</span>
        </div>
      </EdgeLabelRenderer>
    </>
  );
}

function edgeColor(data: CanvasEdgeData, selected: boolean) {
  if (selected) {
    return "#f6c453";
  }
  if (data.violationCount > 0) {
    return "#f87171";
  }
  if (data.diffKind === "deviant-path") {
    return "#fb923c";
  }
  if (data.plane === "designed") {
    return "#71717a";
  }
  if (data.plane === "discovered") {
    return "#e8b84b";
  }
  return "#4ade80";
}

function edgeStyle(data: CanvasEdgeData, selected: boolean) {
  const strokeWidth = selected ? 4 : Math.min(6, 1 + Math.max(data.support, 1));
  return {
    stroke: edgeColor(data, selected),
    strokeDasharray:
      data.isBackEdge ||
      data.plane === "designed" ||
      data.diffKind === "deviant-path"
        ? "7 5"
        : undefined,
    strokeWidth,
  };
}

function selectConformanceIssue(
  graph: WorkflowCanvasProps["graph"],
  kind: Parameters<typeof selectionForConformanceIssue>[1],
  onSelectionChange: ((selection: AppSelection) => void) | undefined
) {
  const nextSelection = selectionForConformanceIssue(graph, kind);
  if (nextSelection) {
    onSelectionChange?.(nextSelection);
  }
}

function canvasDomId(prefix: string, id: string) {
  return `workflow-canvas-${prefix}-${id.replaceAll(/[^A-Za-z0-9_-]/g, "-")}`;
}

function modeLabel(mode: WorkflowCanvasMode) {
  return canvasModes.find(([id]) => id === mode)?.[1] ?? mode;
}

function selectionHasGraphItem(
  selection: WorkflowCanvasProps["selection"]
): selection is NonNullable<WorkflowCanvasProps["selection"]> {
  return Boolean(selection?.node_id || selection?.edge_id);
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

function useDebouncedValue<T>(value: T, delayMs: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timeout = window.setTimeout(() => setDebounced(value), delayMs);
    return () => window.clearTimeout(timeout);
  }, [delayMs, value]);
  return debounced;
}

function assertNever(value: never): never {
  throw new Error(`Unhandled canvas keyboard action ${value}`);
}
