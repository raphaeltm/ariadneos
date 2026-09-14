import type {
  ActivityId,
  GraphEdge,
  GraphEdgeId,
  GraphNode,
  GraphView,
  StepId,
} from "../../../shared/contracts.ts";
import type { ModelEditAction } from "../../api.ts";
import type { AppSelection } from "../../store.ts";

export type GraphEditHandler = (
  action: ModelEditAction,
  payload: Record<string, string>
) => Promise<void> | void;

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
  annotationLabel: string | null;
  annotationTitle: string | null;
  ariaLabel: string;
  canEdit?: boolean;
  diffKind: CanvasNodeDiffKind;
  dragActive?: boolean;
  groundedCount: number;
  groundingRatio: number;
  hasRoleDeviation: boolean;
  hasUnreconciledWork: boolean;
  id: ActivityId | StepId;
  isProposed: boolean;
  label: string;
  onEdit?: GraphEditHandler;
  onRenameNode?: (value: { label: string; nodeId: string }) => void;
  plane: GraphNode["activity"]["plane"];
  role: string;
  severity: CanvasSeverity;
  support: number;
  violationCount: number;
  [key: string]: unknown;
}

export interface CanvasEdgeData {
  annotationLabel: string | null;
  annotationTitle: string | null;
  ariaLabel: string;
  canEdit?: boolean;
  cases: string[];
  diffKind: CanvasEdgeDiffKind;
  editing?: boolean;
  isBackEdge: boolean;
  kind: GraphEdge["kind"];
  label: string;
  onEdit?: GraphEditHandler;
  onRenameEdge?: (value: { edgeId: string; label: string }) => void;
  onStartEditEdge?: (edgeId: string | null) => void;
  plane: GraphEdge["plane"];
  severity: CanvasSeverity;
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
  canEdit?: boolean;
  graph: GraphView;
  initialMinSupport?: number;
  initialMode?: WorkflowCanvasMode;
  onCreateDesignedEdge?: (value: { source: string; target: string }) => void;
  onEdit?: GraphEditHandler;
  onMinSupportChange?: (value: number) => void;
  onModeChange?: (mode: WorkflowCanvasMode) => void;
  onMoveDesignedEdge?: (value: {
    edgeId: string;
    source: string;
    target: string;
  }) => void;
  onRenameEdge?: (value: { edgeId: string; label: string }) => void;
  onRenameNode?: (value: { label: string; nodeId: string }) => void;
  onSelectionChange?: (selection: AppSelection) => void;
  selection?: AppSelection;
}

export type CanvasEdgeDiffKind =
  | "conformant"
  | "deviant-path"
  | "extra-path"
  | "missing-path"
  | "violation";

export type CanvasNodeDiffKind =
  | "conformant"
  | "extra"
  | "missing"
  | "role-deviation"
  | "violation";

export type CanvasSeverity = "critical" | "info" | "none" | "warning";

export type ConformanceIssueKind =
  | "extra"
  | "missing"
  | "role-deviation"
  | "violation";

export interface ConformanceOverlaySummary {
  extraCount: number;
  missingCount: number;
  orderBreakCount: number;
  roleDeviationCount: number;
  violationCount: number;
}
