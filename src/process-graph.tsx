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
} from "@xyflow/react";
import {
  Check,
  CircleDot,
  GitMerge,
  LoaderCircle,
  Scissors,
  X,
} from "lucide-react";
import { useMemo } from "react";
import type { ProcessModel } from "../shared/process.ts";
import type {
  CurationAction,
  CurationDecoration,
  CurationTargetKind,
} from "./curation.ts";

type ActivityNode = Node<{
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
function Activity({ data, selected }: NodeProps<ActivityNode>) {
  return (
    <div
      className={`activity-node ${selected ? "selected" : ""} ${data.terminal ? "terminal" : ""} ${data.curation ? `curated ${data.curation.action}` : ""}`}
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
  onSelect: (value: { kind: "node" | "edge"; id: string }) => void;
  selected: string | undefined;
}) {
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
  return (
    <ReactFlow
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
      onEdgeClick={(_, e) => onSelect({ id: e.id, kind: "edge" })}
      onEdgesChange={(changes) => {
        const change = changes.find((c) => c.type === "select" && c.selected);
        if (change && "id" in change) {
          onSelect({ id: change.id, kind: "edge" });
        }
      }}
      onNodeClick={(_, n) => onSelect({ id: n.id, kind: "node" })}
      onNodesChange={(changes) => {
        const change = changes.find((c) => c.type === "select" && c.selected);
        if (change && "id" in change) {
          onSelect({ id: change.id, kind: "node" });
        }
      }}
      proOptions={{ hideAttribution: false }}
    >
      <Background color="#d9dfd5" gap={22} size={1} />
      <Controls showInteractive={false} />
    </ReactFlow>
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
          className={`edge-curation-label ${selected ? "selected" : ""}`}
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
