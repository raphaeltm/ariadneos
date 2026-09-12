import type {
  ActivityId,
  GraphEdge,
  GraphEdgeId,
  GraphNode,
  GraphView,
  StepId,
} from "../../../shared/contracts.ts";
import type { AppSelection } from "../../store.ts";

export type WorkflowCanvasMode =
  | "designed"
  | "discovered"
  | "instance"
  | "overlay";

export interface CanvasPosition {
  x: number;
  y: number;
}

export type CanvasPositionCache = Record<string, CanvasPosition>;

export interface CanvasNodeData {
  groundedCount: number;
  groundingRatio: number;
  hasRoleDeviation: boolean;
  hasUnreconciledWork: boolean;
  id: ActivityId | StepId;
  isProposed: boolean;
  label: string;
  plane: GraphNode["activity"]["plane"];
  role: string;
  support: number;
  violationCount: number;
  [key: string]: unknown;
}

export interface CanvasEdgeData {
  cases: string[];
  isBackEdge: boolean;
  kind: GraphEdge["kind"];
  label: string;
  plane: GraphEdge["plane"];
  support: number;
  tooltip: string;
  violationCount: number;
  [key: string]: unknown;
}

export interface VisibleCanvasGraph {
  edges: GraphEdge[];
  nodes: GraphNode[];
}

export interface LayoutResult {
  edges: Array<{
    data: CanvasEdgeData;
    id: GraphEdgeId;
    source: string;
    target: string;
  }>;
  nodes: Array<{
    data: CanvasNodeData;
    id: string;
    position: CanvasPosition;
  }>;
  positionCache: CanvasPositionCache;
}

export interface WorkflowCanvasProps {
  graph: GraphView;
  initialMinSupport?: number;
  initialMode?: WorkflowCanvasMode;
  onMinSupportChange?: (value: number) => void;
  onModeChange?: (mode: WorkflowCanvasMode) => void;
  onSelectionChange?: (selection: AppSelection) => void;
  selection?: AppSelection;
}
