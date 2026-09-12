import { useMemo } from "react";
import {
  ReactFlow,
  Background,
  Controls,
  Handle,
  Position,
  MarkerType,
  type Node,
  type NodeProps,
} from "@xyflow/react";
import dagre from "@dagrejs/dagre";
import { Check, CircleDot } from "lucide-react";
import type { ProcessModel } from "../shared/process";
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
      <Handle type="target" position={Position.Top} />
      <div className="node-heading">
        <span className="node-icon">
          {data.terminal ? <Check size={14} /> : <CircleDot size={14} />}
        </span>
        <span>{data.role}</span>
        <span className="node-count">{data.count}</span>
      </div>
      <strong>{data.label}</strong>
      <Handle type="source" position={Position.Bottom} />
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
      rankdir: "TB",
      nodesep: 65,
      ranksep: 70,
      marginx: 30,
      marginy: 25,
    });
    graph.setDefaultEdgeLabel(() => ({}));
    model.nodes.forEach((n) => graph.setNode(n.id, { width: 200, height: 77 }));
    model.edges.forEach((e) => graph.setEdge(e.source, e.target));
    dagre.layout(graph);
    return {
      nodes: model.nodes.map((n) => ({
        id: n.id,
        type: "activity",
        position: { x: graph.node(n.id).x - 100, y: graph.node(n.id).y - 38.5 },
        data: n,
        selected: selected === n.id,
      })),
      edges: model.edges.map((e) => ({
        id: e.id,
        source: e.source,
        target: e.target,
        type: "smoothstep",
        label: `${e.count} · ${Math.round(e.probability * 100)}%`,
        animated: selected === e.id,
        style: {
          stroke:
            selected === e.id
              ? "#bd7b3c"
              : e.probability < 0.35
                ? "#b9b2a5"
                : "#66816e",
          strokeWidth:
            selected === e.id ? 3 : Math.max(1.3, e.probability * 2.8),
          strokeDasharray: e.probability < 0.35 ? "5 4" : undefined,
        },
        labelStyle: { fill: "#66736b", fontSize: 11, fontWeight: 600 },
        labelBgStyle: { fill: "#f9faf6" },
        labelBgPadding: [7, 4] as [number, number],
        markerEnd: {
          type: MarkerType.ArrowClosed,
          color: "#829687",
          width: 16,
          height: 16,
        },
      })),
    };
  }, [model, selected]);
  return (
    <ReactFlow
      key={model.nodes.map((n) => n.id).join()}
      nodes={nodes}
      edges={edges}
      nodeTypes={nodeTypes}
      fitView
      fitViewOptions={{ padding: 0.2 }}
      minZoom={0.3}
      maxZoom={1.5}
      nodesDraggable={false}
      nodesConnectable={false}
      onNodesChange={(changes) => {
        const change = changes.find((c) => c.type === "select" && c.selected);
        if (change && "id" in change) onSelect({ kind: "node", id: change.id });
      }}
      onEdgesChange={(changes) => {
        const change = changes.find((c) => c.type === "select" && c.selected);
        if (change && "id" in change) onSelect({ kind: "edge", id: change.id });
      }}
      onNodeClick={(_, n) => onSelect({ kind: "node", id: n.id })}
      onEdgeClick={(_, e) => onSelect({ kind: "edge", id: e.id })}
      proOptions={{ hideAttribution: false }}
    >
      <Background color="#d9dfd5" gap={22} size={1} />
      <Controls showInteractive={false} />
    </ReactFlow>
  );
}
