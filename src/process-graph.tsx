import dagre from "@dagrejs/dagre";
import {
  Background,
  Controls,
  Handle,
  MarkerType,
  type Node,
  type NodeProps,
  Position,
  ReactFlow,
} from "@xyflow/react";
import { Check, CircleDot } from "lucide-react";
import { useMemo } from "react";
import type { ProcessModel } from "../shared/process.ts";

type ActivityNode = Node<{
  label: string;
  count: number;
  role: string;
  terminal: boolean;
}>;
function Activity({ data, selected }: NodeProps<ActivityNode>) {
  return (
    <div
      className={`activity-node ${selected ? "selected" : ""} ${data.terminal ? "terminal" : ""}`}
    >
      <Handle position={Position.Top} type="target" />
      <div className="node-heading">
        <span className="node-icon">
          {data.terminal ? <Check size={14} /> : <CircleDot size={14} />}
        </span>
        <span>{data.role}</span>
        <span className="node-count">{data.count}</span>
      </div>
      <strong>{data.label}</strong>
      <Handle position={Position.Bottom} type="source" />
    </div>
  );
}
const nodeTypes = { activity: Activity };
export default function ProcessGraph({
  model,
  onSelect,
  selected,
}: {
  model: ProcessModel;
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
      edges: model.edges.map((e) => ({
        animated: selected === e.id,
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
        type: "smoothstep",
      })),
      nodes: model.nodes.map((n) => ({
        data: { ...n },
        id: n.id,
        position: { x: graph.node(n.id).x - 100, y: graph.node(n.id).y - 38.5 },
        selected: selected === n.id,
        type: "activity",
      })),
    };
  }, [model, selected]);
  return (
    <ReactFlow
      edges={edges}
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

function edgeColor(selected: boolean, probability: number) {
  if (selected) {
    return "#bd7b3c";
  }
  return probability < 0.35 ? "#b9b2a5" : "#66816e";
}
