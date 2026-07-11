import { GraphConfigError, GraphCycleError, runGraph, type GraphNode } from './executor';

type Ctx = { multiplier: number };

function required<Out>(
  id: string,
  deps: string[],
  run: GraphNode<Ctx, Out>['run'],
): GraphNode<Ctx, Out> {
  return { id, deps, run, optional: false };
}

function optional<Out>(
  id: string,
  deps: string[],
  run: GraphNode<Ctx, Out>['run'],
  fallback: Out,
): GraphNode<Ctx, Out> {
  return { id, deps, run, optional: true, fallback, label: id, dataLabel: `${id} data` };
}

describe('runGraph', () => {
  it('resolves a simple dependency chain in order, threading get() results forward', async () => {
    const nodes: GraphNode<Ctx, unknown>[] = [
      required<number>('a', [], () => 1),
      required<number>('b', ['a'], (get) => get<number>('a') + 1),
      required<number>('c', ['b'], (get) => get<number>('b') + 1),
    ];
    const result = await runGraph(nodes, { multiplier: 1 });
    expect(result).toEqual({ a: 1, b: 2, c: 3 });
  });

  it('resolves independent nodes with no relative ordering requirement', async () => {
    const nodes: GraphNode<Ctx, unknown>[] = [
      required<number>('x', [], () => 10),
      required<number>('y', [], () => 20),
      required<number>('sum', ['x', 'y'], (get) => get<number>('x') + get<number>('y')),
    ];
    const result = await runGraph(nodes, { multiplier: 1 });
    expect(result).toEqual({ x: 10, y: 20, sum: 30 });
  });

  it('passes ctx through to every node', async () => {
    const nodes: GraphNode<Ctx, unknown>[] = [
      required<number>('scaled', [], (_get, ctx) => ctx.multiplier * 5),
    ];
    const result = await runGraph(nodes, { multiplier: 3 });
    expect(result).toEqual({ scaled: 15 });
  });

  it('uses the fallback and calls onNodeFailure when an optional node throws', async () => {
    const onNodeFailure = jest.fn();
    const nodes: GraphNode<Ctx, unknown>[] = [
      optional<number[]>(
        'flaky',
        [],
        () => {
          throw new Error('subprocess exploded');
        },
        [],
      ),
    ];
    const result = await runGraph(nodes, { multiplier: 1 }, { onNodeFailure });
    expect(result).toEqual({ flaky: [] });
    expect(onNodeFailure).toHaveBeenCalledTimes(1);
    const [failedNode, error] = onNodeFailure.mock.calls[0];
    expect(failedNode.id).toBe('flaky');
    expect((error as Error).message).toBe('subprocess exploded');
  });

  it("lets a downstream node consume an upstream optional node's fallback value", async () => {
    const nodes: GraphNode<Ctx, unknown>[] = [
      optional<number[]>(
        'flaky',
        [],
        () => {
          throw new Error('nope');
        },
        [],
      ),
      required<number>('count', ['flaky'], (get) => get<number[]>('flaky').length),
    ];
    const result = await runGraph(nodes, { multiplier: 1 }, { onNodeFailure: () => {} });
    expect(result).toEqual({ flaky: [], count: 0 });
  });

  it('propagates (rejects) when a non-optional node throws - a "never throws" node throwing is a real bug', async () => {
    const nodes: GraphNode<Ctx, unknown>[] = [
      required<number>('buggy', [], () => {
        throw new Error('this should never happen');
      }),
    ];
    await expect(runGraph(nodes, { multiplier: 1 })).rejects.toThrow('this should never happen');
  });

  it('throws GraphConfigError for a dependency on an unknown node id', async () => {
    const nodes: GraphNode<Ctx, unknown>[] = [
      required<number>('a', ['nonexistent'], (get) => get('nonexistent')),
    ];
    await expect(runGraph(nodes, { multiplier: 1 })).rejects.toThrow(GraphConfigError);
  });

  it('throws GraphCycleError for a cycle', async () => {
    const nodes: GraphNode<Ctx, unknown>[] = [
      required<number>('a', ['b'], (get) => get<number>('b')),
      required<number>('b', ['a'], (get) => get<number>('a')),
    ];
    await expect(runGraph(nodes, { multiplier: 1 })).rejects.toThrow(GraphCycleError);
  });

  it('defaults to sequential execution - independent nodes run one at a time, not concurrently', async () => {
    const order: string[] = [];
    const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
    const nodes: GraphNode<Ctx, unknown>[] = [
      required<void>('slow-1', [], async () => {
        order.push('slow-1 start');
        await delay(20);
        order.push('slow-1 end');
      }),
      required<void>('slow-2', [], async () => {
        order.push('slow-2 start');
        await delay(20);
        order.push('slow-2 end');
      }),
    ];
    await runGraph(nodes, { multiplier: 1 });
    // Sequential: the first node fully finishes (start AND end) before the second even starts.
    expect(order).toEqual(['slow-1 start', 'slow-1 end', 'slow-2 start', 'slow-2 end']);
  });

  it('level-parallel mode runs independent nodes in the same level concurrently', async () => {
    const order: string[] = [];
    const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
    const nodes: GraphNode<Ctx, unknown>[] = [
      required<void>('slow-1', [], async () => {
        order.push('slow-1 start');
        await delay(20);
        order.push('slow-1 end');
      }),
      required<void>('slow-2', [], async () => {
        order.push('slow-2 start');
        await delay(20);
        order.push('slow-2 end');
      }),
    ];
    await runGraph(nodes, { multiplier: 1 }, { concurrency: 'level-parallel' });
    // Concurrent: both start before either ends.
    expect(order.slice(0, 2).sort()).toEqual(['slow-1 start', 'slow-2 start']);
  });

  it('does not run a dependent until its dependency has resolved, even in level-parallel mode', async () => {
    const nodes: GraphNode<Ctx, unknown>[] = [
      required<number>('a', [], async () => {
        await new Promise((resolve) => setTimeout(resolve, 10));
        return 1;
      }),
      required<number>('b', ['a'], (get) => get<number>('a') + 1),
    ];
    const result = await runGraph(nodes, { multiplier: 1 }, { concurrency: 'level-parallel' });
    expect(result).toEqual({ a: 1, b: 2 });
  });
});
