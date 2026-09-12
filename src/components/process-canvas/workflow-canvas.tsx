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
} from "@xyflow/react";
import { AlertTriangle, Link2, RotateCcw, ShieldCheck } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import type { GraphEdge } from "../../../shared/contracts.ts";
import {
  filterCanvasGraph,
  layoutCanvasGraph,
  selectionForEdge,
  selectionForNode,
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
  const debouncedMode = useDebouncedValue(mode, 250);
  const debouncedSupport = useDebouncedValue(minSupport, 250);
  const positionCache = useRef<CanvasPositionCache>({});
  const visible = useMemo(
    () => filterCanvasGraph(graph, debouncedMode, debouncedSupport),
    [graph, debouncedMode, debouncedSupport]
  );
  const layout = useMemo(() => {
    const next = layoutCanvasGraph(visible, positionCache.current);
    positionCache.current = next.positionCache;
    return next;
  }, [visible]);
  const selectedId = selection?.node_id ?? selection?.edge_id;
  const edgeById = useMemo(
    () => new Map(graph.edges.map((edge) => [edge.id, edge])),
    [graph.edges]
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
  };
  const changeSupport = (value: number) => {
    setMinSupport(value);
    onMinSupportChange?.(value);
  };
  return (
    <section
      aria-label="Workflow canvas"
      className="workflow-canvas"
      data-mode={mode}
    >
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
              onSelectionChange?.(selectionForEdge(graph, graphEdge));
            }
          }}
          onNodeClick={(_, node) =>
            onSelectionChange?.(
              selectionForNode(graph, node.id as WorkflowNode["data"]["id"])
            )
          }
          panOnDrag
          proOptions={{ hideAttribution: true }}
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
          onClick={() => {
            const missingSlug = conformance?.missing[0]?.slug;
            const missingNode = graph.nodes.find(
              (node) => node.activity.slug === missingSlug
            );
            if (missingNode) {
              onSelectionChange?.(selectionForNode(graph, missingNode.id));
            }
          }}
          type="button"
        >
          skipped <strong>{conformance?.missing.length ?? 0}</strong>
        </button>
        <button type="button">
          undocumented <strong>{conformance?.extra.length ?? 0}</strong>
        </button>
        <button type="button">
          role deviations{" "}
          <strong>{conformance?.role_deviations.length ?? 0}</strong>
        </button>
        <span>{visible.nodes.length} nodes visible</span>
      </fieldset>
    </section>
  );
}

function ActivityNode({ data, selected }: NodeProps<WorkflowNode>) {
  const groundingPercent = Math.round(data.groundingRatio * 100);
  return (
    <div
      className={`canvas-node plane-${data.plane} ${selected ? "selected" : ""} ${
        data.isProposed ? "is-proposed" : ""
      } ${data.violationCount ? "has-violation" : ""}`}
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
        <span className="support-badge">x{data.support}</span>
      </div>
      <strong>{data.label}</strong>
      {data.groundingRatio > 0 && data.groundingRatio < 1 ? (
        <meter
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
          className={`canvas-edge-label ${props.selected ? "selected" : ""}`}
          style={{
            transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)`,
          }}
          title={data.tooltip}
        >
          {data.violationCount > 0 ? <AlertTriangle size={11} /> : null}
          {data.isBackEdge ? <RotateCcw size={11} /> : null}
          <span>{data.label}</span>
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
      data.isBackEdge || data.plane === "designed" ? "7 5" : undefined,
    strokeWidth,
  };
}

function useDebouncedValue<T>(value: T, delayMs: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timeout = window.setTimeout(() => setDebounced(value), delayMs);
    return () => window.clearTimeout(timeout);
  }, [delayMs, value]);
  return debounced;
}
