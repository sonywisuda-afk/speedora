// Generic dependency-graph executor - deliberately ZERO knowledge of render-clip, Prisma, BullMQ,
// or any AI-signal concept. This is what would get lifted verbatim into a package if a second real
// consumer (beyond render-clip.worker.ts) ever needs graph-based orchestration - see
// ARCHITECTURE.md's "Composing multiple modules" section for why it isn't one already.

export type NodeId = string;

// One node in the graph. `Ctx` is whatever ambient, already-resolved context every node's `run`
// needs (job id, source path, time range, ...) - the executor never inspects `Ctx`'s shape, only
// passes it through.
export interface GraphNode<Ctx, Out = unknown> {
  id: NodeId;
  // Other node ids this node reads via `get()` inside its own `run`. Used only to compute
  // execution order (Kahn's algorithm) - NOT enforced against what `run` actually calls `get()`
  // with at runtime (a node reading an id outside its declared `deps` would still resolve
  // correctly today, just without being reflected in execution ordering). Acceptable v1
  // simplification, not a silent correctness gap: a wrong `deps` list only risks running a node
  // too early relative to a dependency it undeclaredly reads, which `get()`'s own "read before
  // resolved" guard below turns into an immediate thrown error, not a silent wrong value.
  deps: readonly NodeId[];
  run: (get: <T>(id: NodeId) => T, ctx: Ctx) => Promise<Out> | Out;
  // true = failures are caught, logged via `onNodeFailure`, and `fallback` is used instead (the
  // "external I/O that's allowed to fail without failing the job" case). false = failures
  // propagate uncaught (a node documented as "never throws" that throws anyway is a real bug,
  // not a soft-fail case - same distinction render-clip.worker.ts's raw detectors vs. its pure
  // derive functions already draw today, just formalized here instead of duplicated per call site).
  optional: boolean;
  // Required iff optional: true.
  fallback?: Out;
  // Only meaningful when optional: true - passed to onNodeFailure for a caller-specific log
  // message. The executor itself never logs anything by this name; see defaultOnNodeFailure below
  // for the generic fallback behavor when a caller doesn't override it.
  label?: string;
  dataLabel?: string;
}

export class GraphConfigError extends Error {}
export class GraphCycleError extends Error {}

function computeLevels<Ctx>(
  nodes: ReadonlyArray<GraphNode<Ctx, unknown>>,
): GraphNode<Ctx, unknown>[][] {
  const nodesById = new Map(nodes.map((node) => [node.id, node]));

  for (const node of nodes) {
    for (const dep of node.deps) {
      if (!nodesById.has(dep)) {
        throw new GraphConfigError(
          `Node "${node.id}" declares a dependency on unknown node "${dep}".`,
        );
      }
    }
  }

  const inDegree = new Map<NodeId, number>();
  const dependents = new Map<NodeId, NodeId[]>();
  for (const node of nodes) {
    inDegree.set(node.id, node.deps.length);
    for (const dep of node.deps) {
      const existing = dependents.get(dep);
      if (existing) existing.push(node.id);
      else dependents.set(dep, [node.id]);
    }
  }

  const levels: GraphNode<Ctx, unknown>[][] = [];
  const resolved = new Set<NodeId>();
  let currentLevelIds = nodes.filter((node) => inDegree.get(node.id) === 0).map((node) => node.id);

  while (currentLevelIds.length > 0) {
    levels.push(currentLevelIds.map((id) => nodesById.get(id)!));
    const nextLevelIds: NodeId[] = [];
    for (const id of currentLevelIds) {
      resolved.add(id);
      for (const dependentId of dependents.get(id) ?? []) {
        const remaining = inDegree.get(dependentId)! - 1;
        inDegree.set(dependentId, remaining);
        if (remaining === 0) nextLevelIds.push(dependentId);
      }
    }
    currentLevelIds = nextLevelIds;
  }

  if (resolved.size !== nodes.length) {
    const stuck = nodes.filter((node) => !resolved.has(node.id)).map((node) => node.id);
    throw new GraphCycleError(`Cycle detected among nodes: ${stuck.join(', ')}`);
  }

  return levels;
}

function defaultOnNodeFailure<Ctx>(node: GraphNode<Ctx, unknown>, error: unknown): void {
  console.warn(`[render-graph] node "${node.id}" failed, using its fallback value:`, error);
}

export interface RunGraphOptions<Ctx> {
  // 'sequential' (default) walks levels in order and awaits one node at a time within a level -
  // identical execution order/timing to a hand-written sequential `await` chain. 'level-parallel'
  // runs every node in a level concurrently via Promise.all - only nodes with no dependency on
  // each other are ever run this way, by construction (that's what a "level" is), but this mode is
  // not the default anywhere it's wired up yet - see ARCHITECTURE.md for why turning it on for
  // real detectors needs a capacity-planning decision this executor doesn't make.
  concurrency?: 'sequential' | 'level-parallel';
  onNodeFailure?: (node: GraphNode<Ctx, unknown>, error: unknown, ctx: Ctx) => void;
}

// Runs every node in dependency order, returning a plain object keyed by node id. Deliberately
// returns Record<NodeId, unknown>, not a precisely-typed object - full type-level tracking of
// "which node id maps to which Out type" needs a mapped type keyed by literal ids, which adds real
// complexity for ~30 nodes; callers instead define their own hand-written result interface and do
// one contained cast at the seam (see render-graph/index.ts) - the same "one cast at a trusted
// boundary" shape this codebase already uses elsewhere (see ARCHITECTURE.md's ClipScores casts).
export async function runGraph<Ctx>(
  nodes: ReadonlyArray<GraphNode<Ctx, unknown>>,
  ctx: Ctx,
  options: RunGraphOptions<Ctx> = {},
): Promise<Record<NodeId, unknown>> {
  const { concurrency = 'sequential', onNodeFailure = defaultOnNodeFailure } = options;
  const levels = computeLevels(nodes);

  const results = new Map<NodeId, unknown>();
  const get = <T>(id: NodeId): T => {
    if (!results.has(id)) {
      throw new Error(`Node "${id}" was read before it was resolved - check its declared deps.`);
    }
    return results.get(id) as T;
  };

  const runOne = async (node: GraphNode<Ctx, unknown>): Promise<void> => {
    try {
      results.set(node.id, await node.run(get, ctx));
    } catch (error) {
      if (!node.optional) throw error;
      onNodeFailure(node, error, ctx);
      results.set(node.id, node.fallback);
    }
  };

  for (const level of levels) {
    if (concurrency === 'level-parallel') {
      await Promise.all(level.map(runOne));
    } else {
      for (const node of level) await runOne(node);
    }
  }

  return Object.fromEntries(results);
}
