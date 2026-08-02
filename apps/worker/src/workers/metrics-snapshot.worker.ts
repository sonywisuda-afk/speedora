import {
  computeAvgProcessingTimeMs,
  computeAvgQueueWaitMs,
  computeFailureRate,
  countRetriedJobs,
  heartbeatKeyPattern,
  parseHeartbeatPayload,
  QueueName,
} from '@speedora/shared';
import { Queue, Worker } from 'bullmq';
import { forStage } from '../logger';
import { prisma } from '../prisma';
import { metricsSnapshotQueue } from '../queues';
import { createRedisConnection } from '../redis';

const logger = forStage('metrics-snapshot');

// PR #45 (Production Metrics Collection, post-Oracle-hybrid-Fase-3 roadmap)
// - purely data collection, nothing else. Deliberately does NOT: evaluate
// alert conditions, make a scaling decision, aggregate/summarize for a
// dashboard (PR #44 already reads live state directly for that), or run
// any AI/predictive analysis over the numbers it writes. Every tick just
// samples the same live BullMQ/Redis state GET /queues and
// GET /workers/health already expose (reusing the exact same pure
// functions from @speedora/shared's queue-metrics.ts/worker-heartbeat.ts)
// and appends one row per queue/worker to Postgres - the history those two
// endpoints can't provide on their own, since they only ever show "right
// now". A later PR reads QueueSnapshot/WorkerHeartbeatSnapshot's
// accumulated history to evaluate whether autoscaling is actually
// warranted, using real trends instead of a single live sample.
//
// How often this runs - a balance between "enough resolution to see real
// trends" and "don't multiply Redis load for an operational nice-to-have"
// (each tick does the same bounded per-queue sampling GET /queues does,
// see MAX_RECENT_JOBS_TO_INSPECT below, times 16 queues). Not calibrated
// against production data (there is none yet) - same "no data to calibrate
// against" posture as packages/shared/src/utils/alert-conditions.ts's own
// thresholds.
const SNAPSHOT_INTERVAL_MS = 5 * 60 * 1000;
const SNAPSHOT_TRIGGER_JOB_ID = 'metrics-snapshot-poll';

// Same bound as apps/api/src/monitoring/monitoring.controller.ts's own
// MAX_RECENT_JOBS_TO_INSPECT - deliberately kept in sync with that
// endpoint's sampling window so a QueueSnapshot row and a live GET /queues
// response captured at the same moment read as the same numbers, not two
// different sampling strategies drifting apart over time.
const MAX_RECENT_JOBS_TO_INSPECT = 50;

// Registers the single repeatable trigger that fires this worker's
// processor every SNAPSHOT_INTERVAL_MS - called once at startup (see
// main.ts). Idempotent, same as every other *.worker.ts's version of this.
export async function scheduleRepeatingTrigger(): Promise<void> {
  await metricsSnapshotQueue.add(
    QueueName.METRICS_SNAPSHOT,
    {},
    { repeat: { every: SNAPSHOT_INTERVAL_MS }, jobId: SNAPSHOT_TRIGGER_JOB_ID },
  );
}

async function snapshotQueue(queue: Queue, queueName: QueueName) {
  const [rawCounts, completed, failed] = await Promise.all([
    queue.getJobCounts('waiting', 'active', 'completed', 'failed', 'delayed', 'paused'),
    queue.getJobs(['completed'], 0, MAX_RECENT_JOBS_TO_INSPECT - 1),
    queue.getJobs(['failed'], 0, MAX_RECENT_JOBS_TO_INSPECT - 1),
  ]);

  const completedCount = rawCounts.completed ?? 0;
  const failedCount = rawCounts.failed ?? 0;

  return {
    queueName,
    waiting: rawCounts.waiting ?? 0,
    active: rawCounts.active ?? 0,
    completed: completedCount,
    failed: failedCount,
    delayed: rawCounts.delayed ?? 0,
    paused: rawCounts.paused ?? 0,
    // likelyStalled (GET /queues' active-job-age heuristic) is
    // deliberately NOT captured here - it needs a live BullMQ Worker's
    // stalled-job recovery context to mean anything, and re-deriving it
    // from a point-in-time snapshot later would need the same active-job
    // list this tick already discarded. GET /queues remains the place to
    // check it live.
    likelyStalled: 0,
    failureRate: computeFailureRate(failedCount, completedCount),
    avgProcessingTimeMs: computeAvgProcessingTimeMs(completed),
    avgQueueWaitMs: computeAvgQueueWaitMs(completed),
    retriedJobs: countRetriedJobs([...completed, ...failed]),
  };
}

// Every read-only Queue handle plus the heartbeat KEYS/GET/TTL scan below
// share ONE connection, opened fresh at the start of a tick and closed at
// the end (`finally`, so a mid-tick failure still cleans up) - not kept
// open across ticks. This runs once every SNAPSHOT_INTERVAL_MS (minutes,
// not a hot path), so the reconnect cost each tick is negligible, and it
// avoids this being the one worker in the codebase whose Worker.close()
// needs to know about extra resources main.ts's shutdown() has no
// visibility into - every other *.worker.ts's createXWorker() returns a
// plain Worker with nothing extra to clean up, and this keeps that
// uniform.
async function captureSnapshot(): Promise<void> {
  const connection = createRedisConnection();
  const queues = Object.values(QueueName).map((name) => ({
    name,
    queue: new Queue(name, { connection }),
  }));

  try {
    const [queueSnapshots, heartbeatKeys] = await Promise.all([
      Promise.all(queues.map(({ name, queue }) => snapshotQueue(queue, name))),
      connection.keys(heartbeatKeyPattern()),
    ]);

    await prisma.queueSnapshot.createMany({ data: queueSnapshots });

    if (heartbeatKeys.length > 0) {
      const [rawValues, ttls] = await Promise.all([
        Promise.all(heartbeatKeys.map((key) => connection.get(key))),
        Promise.all(heartbeatKeys.map((key) => connection.ttl(key))),
      ]);

      const workerSnapshots = rawValues
        .map((raw, index) => {
          const payload = parseHeartbeatPayload(raw);
          // Same race as apps/api's GET /workers/health - a heartbeat key
          // can expire between the KEYS scan and this GET, both TTL-based.
          // Skipped, not treated as an error.
          if (!payload) return null;
          const counts = payload.queues.reduce(
            (sum, queueName) => {
              const snapshot = queueSnapshots.find((snap) => snap.queueName === queueName);
              return snapshot
                ? {
                    active: sum.active + snapshot.active,
                    waiting: sum.waiting + snapshot.waiting,
                  }
                : sum;
            },
            { active: 0, waiting: 0 },
          );
          return {
            workerId: payload.workerId,
            queues: payload.queues,
            jobsActive: counts.active,
            jobsWaiting: counts.waiting,
            workerStartedAt: new Date(payload.startedAt),
            heartbeatTtlSeconds: ttls[index],
          };
        })
        .filter((snapshot): snapshot is NonNullable<typeof snapshot> => snapshot !== null);

      if (workerSnapshots.length > 0) {
        await prisma.workerHeartbeatSnapshot.createMany({ data: workerSnapshots });
      }
    }

    logger.info('captured metrics snapshot', {
      queueCount: queueSnapshots.length,
      workerCount: heartbeatKeys.length,
    });
  } finally {
    // Every Queue.close() first (BullMQ's own per-instance cleanup, not
    // just the shared socket), then the connection they all share -
    // closing the connection first would leave each Queue.close() call
    // hanging trying to talk to an already-closed socket.
    await Promise.all(queues.map(({ queue }) => queue.close()));
    await connection.quit();
  }
}

export function createMetricsSnapshotWorker(): Worker {
  return new Worker(QueueName.METRICS_SNAPSHOT, captureSnapshot, {
    connection: createRedisConnection(),
  });
}
