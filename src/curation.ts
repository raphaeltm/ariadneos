import type {
  ProcessEdge,
  ProcessModel,
  ProcessNode,
  WorkflowId,
} from "../shared/process.ts";

export type CurationAction = "confirm" | "merge" | "reject" | "split";
export type CurationTargetKind = "edge" | "node";
export type CurationPersistence = "failed" | "local" | "pending" | "saved";

export interface CurationDraft {
  action: CurationAction;
  createdAt: string;
  id: string;
  mergeTargetId?: string;
  persistence: CurationPersistence;
  targetId: string;
  targetKind: CurationTargetKind;
  undone?: boolean;
}

export interface CurationDecoration {
  action: CurationAction;
  persistence: CurationPersistence;
}

export interface CurationProjection {
  edgeDecorations: Record<string, CurationDecoration>;
  model: ProcessModel;
  nodeDecorations: Record<string, CurationDecoration>;
}

export interface PersistCurationResult {
  detail?: string;
  persisted: boolean;
}

export function legalCurationActions(
  targetKind: CurationTargetKind,
  targetId: string,
  model: ProcessModel
): CurationAction[] {
  if (targetKind === "edge") {
    return model.edges.some((edge) => edge.id === targetId)
      ? ["confirm", "reject", "split"]
      : [];
  }
  const node = model.nodes.find((item) => item.id === targetId);
  if (!node) {
    return [];
  }
  const actions: CurationAction[] = ["confirm", "reject", "split"];
  if (pickMergeTarget(model, targetId)) {
    actions.splice(2, 0, "merge");
  }
  return actions;
}

export function createCurationDraft({
  action,
  id = globalThis.crypto?.randomUUID?.() ?? fallbackId(),
  model,
  now = new Date().toISOString(),
  targetId,
  targetKind,
}: {
  action: CurationAction;
  id?: string;
  model: ProcessModel;
  now?: string;
  targetId: string;
  targetKind: CurationTargetKind;
}): CurationDraft {
  if (!legalCurationActions(targetKind, targetId, model).includes(action)) {
    throw new Error(`Cannot ${action} selected ${targetKind}.`);
  }
  return {
    action,
    createdAt: now,
    id,
    mergeTargetId:
      action === "merge" && targetKind === "node"
        ? pickMergeTarget(model, targetId)
        : undefined,
    persistence: "pending",
    targetId,
    targetKind,
  };
}

export function applyCurationEdits(
  model: ProcessModel,
  drafts: readonly CurationDraft[]
): CurationProjection {
  let nodes = model.nodes.map((node) => ({ ...node }));
  let edges = model.edges.map((edge) => ({ ...edge }));
  const edgeDecorations: Record<string, CurationDecoration> = {};
  const nodeDecorations: Record<string, CurationDecoration> = {};
  for (const draft of drafts.filter((item) => !item.undone)) {
    if (draft.targetKind === "node") {
      nodeDecorations[draft.targetId] = decorationFor(draft);
    } else {
      edgeDecorations[draft.targetId] = decorationFor(draft);
    }
    if (draft.action === "confirm") {
      continue;
    }
    if (draft.action === "reject") {
      if (draft.targetKind === "node") {
        nodes = nodes.filter((node) => node.id !== draft.targetId);
        edges = edges.filter(
          (edge) =>
            edge.source !== draft.targetId && edge.target !== draft.targetId
        );
      } else {
        edges = edges.filter((edge) => edge.id !== draft.targetId);
      }
      continue;
    }
    if (draft.action === "merge" && draft.targetKind === "node") {
      const merged = mergeNode(
        nodes,
        edges,
        draft.targetId,
        draft.mergeTargetId
      );
      ({ edges, nodes } = merged);
      if (draft.mergeTargetId) {
        nodeDecorations[draft.mergeTargetId] = decorationFor(draft);
      }
      continue;
    }
    if (draft.action === "split") {
      const split =
        draft.targetKind === "node"
          ? splitNode(nodes, edges, draft.targetId, draft.id)
          : splitEdge(nodes, edges, draft.targetId, draft.id);
      ({ edges, nodes } = split);
    }
  }
  return {
    edgeDecorations,
    model: {
      ...model,
      edges,
      nodes,
    },
    nodeDecorations,
  };
}

export function updateCurationDraft(
  drafts: readonly CurationDraft[],
  id: string,
  patch: Partial<Pick<CurationDraft, "persistence" | "undone">>
): CurationDraft[] {
  return drafts.map((draft) =>
    draft.id === id
      ? {
          ...draft,
          ...patch,
        }
      : draft
  );
}

export function undoLastCurationDraft(
  drafts: readonly CurationDraft[]
): CurationDraft[] {
  let index = -1;
  for (let draftIndex = drafts.length - 1; draftIndex >= 0; draftIndex -= 1) {
    const draft = drafts[draftIndex];
    if (draft && !draft.undone) {
      index = draftIndex;
      break;
    }
  }
  if (index < 0) {
    return [...drafts];
  }
  return drafts.map((draft, draftIndex) =>
    draftIndex === index ? { ...draft, undone: true } : draft
  );
}

export async function persistCurationDraft(
  draft: CurationDraft,
  workflow: WorkflowId,
  fetcher: typeof fetch = fetch
): Promise<PersistCurationResult> {
  const response = await fetcher("/api/model/edit", {
    body: JSON.stringify({
      action: draft.action,
      payload: {
        merge_target_id: draft.mergeTargetId,
        target_id: draft.targetId,
        target_kind: draft.targetKind,
      },
      request_id: draft.id,
      workflow,
    }),
    headers: { "Content-Type": "application/json" },
    method: "POST",
  });
  if (response.ok) {
    return { persisted: true };
  }
  if (response.status === 404) {
    return {
      detail: "The model edit API is not available on this revision.",
      persisted: false,
    };
  }
  throw new Error(await readError(response));
}

export async function persistCurationUndo(
  workflow: WorkflowId,
  fetcher: typeof fetch = fetch
): Promise<PersistCurationResult> {
  const response = await fetcher("/api/model/edit/undo", {
    body: JSON.stringify({ workflow }),
    headers: { "Content-Type": "application/json" },
    method: "POST",
  });
  if (response.ok) {
    return { persisted: true };
  }
  if (response.status === 404) {
    return {
      detail: "The model edit undo API is not available on this revision.",
      persisted: false,
    };
  }
  throw new Error(await readError(response));
}

export function curationSummary(drafts: readonly CurationDraft[]) {
  const active = drafts.filter((draft) => !draft.undone);
  return {
    active: active.length,
    failed: active.filter((draft) => draft.persistence === "failed").length,
    local: active.filter((draft) => draft.persistence === "local").length,
    pending: active.filter((draft) => draft.persistence === "pending").length,
    saved: active.filter((draft) => draft.persistence === "saved").length,
  };
}

function decorationFor(draft: CurationDraft): CurationDecoration {
  return {
    action: draft.action,
    persistence: draft.persistence,
  };
}

function fallbackId() {
  return `cur_${Date.now().toString(36)}_${Math.random()
    .toString(36)
    .slice(2, 8)}`;
}

function mergeEdgePair(edges: readonly ProcessEdge[]): ProcessEdge {
  const [first] = edges;
  if (!first) {
    throw new Error("Cannot merge an empty edge group.");
  }
  const evidence = edges.flatMap((edge) => edge.evidence);
  const count = edges.reduce((sum, edge) => sum + edge.count, 0);
  return {
    ...first,
    cases: new Set(evidence.map((item) => item.caseId)).size,
    count,
    evidence,
    id: `${first.source}::${first.target}`,
    medianMinutes: weightedMedian(edges),
    probability: Math.min(
      1,
      edges.reduce((sum, edge) => sum + edge.probability, 0)
    ),
  };
}

function mergeNode(
  nodes: readonly ProcessNode[],
  edges: readonly ProcessEdge[],
  sourceId: string,
  targetId: string | undefined
) {
  if (!targetId || sourceId === targetId) {
    return { edges: [...edges], nodes: [...nodes] };
  }
  const source = nodes.find((node) => node.id === sourceId);
  const target = nodes.find((node) => node.id === targetId);
  if (!(source && target)) {
    return { edges: [...edges], nodes: [...nodes] };
  }
  const nextNodes = nodes
    .filter((node) => node.id !== sourceId)
    .map((node) =>
      node.id === targetId
        ? {
            ...node,
            actors: [...new Set([...node.actors, ...source.actors])],
            count: node.count + source.count,
            terminal: node.terminal && source.terminal,
          }
        : { ...node }
    );
  const rewired = edges
    .map((edge) => ({
      ...edge,
      source: edge.source === sourceId ? targetId : edge.source,
      target: edge.target === sourceId ? targetId : edge.target,
    }))
    .filter((edge) => edge.source !== edge.target);
  return { edges: dedupeEdges(rewired), nodes: nextNodes };
}

function pickMergeTarget(
  model: ProcessModel,
  nodeId: string
): string | undefined {
  const neighborIds = model.edges
    .filter((edge) => edge.source === nodeId || edge.target === nodeId)
    .flatMap((edge) => [edge.source, edge.target])
    .filter((id) => id !== nodeId);
  return neighborIds
    .map((id) => model.nodes.find((node) => node.id === id))
    .filter((node): node is ProcessNode => Boolean(node))
    .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label))[0]?.id;
}

function readError(response: Response) {
  return response
    .json()
    .then((payload: unknown) =>
      typeof payload === "object" &&
      payload !== null &&
      "error" in payload &&
      typeof (payload as { error?: unknown }).error === "string"
        ? (payload as { error: string }).error
        : "Unable to save curation edit."
    )
    .catch(() => "Unable to save curation edit.");
}

function splitEdge(
  nodes: readonly ProcessNode[],
  edges: readonly ProcessEdge[],
  edgeId: string,
  draftId: string
) {
  const edge = edges.find((item) => item.id === edgeId);
  if (!edge) {
    return { edges: [...edges], nodes: [...nodes] };
  }
  const splitId = `${edge.id}::split::${draftId}`;
  const splitNodeItem: ProcessNode = {
    actors: [],
    count: edge.count,
    id: splitId,
    label: "Curated handoff",
    role: "Curation",
    terminal: false,
  };
  return {
    edges: [
      ...edges.filter((item) => item.id !== edgeId),
      splitTransition(edge, edge.source, splitId),
      splitTransition(edge, splitId, edge.target),
    ],
    nodes: [...nodes, splitNodeItem],
  };
}

function splitNode(
  nodes: readonly ProcessNode[],
  edges: readonly ProcessEdge[],
  nodeId: string,
  draftId: string
) {
  const node = nodes.find((item) => item.id === nodeId);
  if (!node) {
    return { edges: [...edges], nodes: [...nodes] };
  }
  const firstId = `${node.id}::split-a::${draftId}`;
  const secondId = `${node.id}::split-b::${draftId}`;
  const firstCount = Math.max(1, Math.ceil(node.count / 2));
  const secondCount = Math.max(1, node.count - firstCount);
  const nextNodes: ProcessNode[] = [
    ...nodes.filter((item) => item.id !== nodeId),
    {
      ...node,
      count: firstCount,
      id: firstId,
      label: `${node.label} A`,
      terminal: false,
    },
    {
      ...node,
      count: secondCount,
      id: secondId,
      label: `${node.label} B`,
    },
  ];
  const rewired = edges.map((edge) => ({
    ...edge,
    source: edge.source === nodeId ? secondId : edge.source,
    target: edge.target === nodeId ? firstId : edge.target,
  }));
  const bridge: ProcessEdge = {
    cases: node.count,
    count: node.count,
    evidence: [],
    id: `${firstId}::${secondId}`,
    medianMinutes: 0,
    probability: 1,
    source: firstId,
    target: secondId,
  };
  return { edges: dedupeEdges([...rewired, bridge]), nodes: nextNodes };
}

function splitTransition(
  edge: ProcessEdge,
  source: string,
  target: string
): ProcessEdge {
  return {
    ...edge,
    id: `${source}::${target}`,
    source,
    target,
  };
}

function dedupeEdges(edges: readonly ProcessEdge[]): ProcessEdge[] {
  const grouped = new Map<string, ProcessEdge[]>();
  for (const edge of edges) {
    const id = `${edge.source}::${edge.target}`;
    grouped.set(id, [...(grouped.get(id) ?? []), { ...edge, id }]);
  }
  return [...grouped.values()].map(mergeEdgePair);
}

function weightedMedian(edges: readonly ProcessEdge[]) {
  const count = edges.reduce((sum, edge) => sum + edge.count, 0);
  if (count <= 0) {
    return 0;
  }
  return (
    edges.reduce((sum, edge) => sum + edge.medianMinutes * edge.count, 0) /
    count
  );
}
