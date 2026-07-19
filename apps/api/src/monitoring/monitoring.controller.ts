import { InjectQueue } from '@nestjs/bullmq';
import { Controller, Get, Logger, ServiceUnavailableException } from '@nestjs/common';
import {
  DEFAULT_ALERT_THRESHOLDS,
  hasLikelyStalledJobs,
  isBackupStale,
  isDependencyDown,
  isFailureRateHigh,
  isHeapPressureHigh,
  isQueueBacklogged,
  isWorkerOffline,
  QueueName,
} from '@speedora/shared';
import { checkStorageConnection, getBucketUsage } from '@speedora/storage';
import type { Queue } from 'bullmq';
import { getBackupStatus } from '../health/backup-status';
import { PrismaService } from '../prisma/prisma.service';
import { alertStateTracker, type AlertDefinition } from './alert-state';
import { metricsRegistry } from './metrics-registry';

// A request stuck in 'active' this long with no progress is worth flagging
// even though BullMQ's own stalled-job recovery (maxStalledCount, on the
// Worker side) already handles the actual recovery - this is purely a
// visibility signal for GET /queues, not a replacement for that mechanism.
const LIKELY_STALLED_THRESHOLD_MS = 5 * 60 * 1000;
// Bounds the cost of the stalled-job check below to a fixed amount of work
// regardless of how many jobs are active - an operational endpoint should
// never itself become a slow query against Redis.
const MAX_ACTIVE_JOBS_TO_INSPECT = 100;

async function countLikelyStalled(queue: Queue): Promise<number> {
  const active = await queue.getJobs(['active'], 0, MAX_ACTIVE_JOBS_TO_INSPECT - 1);
  const now = Date.now();
  return active.filter(
    (job) => job.processedOn && now - job.processedOn > LIKELY_STALLED_THRESHOLD_MS,
  ).length;
}

// getJobCounts() is typed as a bare index signature ({[index: string]:
// number}) - spelled out here as named fields instead of spread directly,
// both for a stable shape callers (GET /alerts) can destructure and
// because TS doesn't propagate an index-signature-only type through
// object spread the way you'd expect.
interface QueueCounts {
  waiting: number;
  active: number;
  completed: number;
  failed: number;
  delayed: number;
  paused: number;
  likelyStalled: number;
}

@Controller()
export class MonitoringController {
  private readonly logger = new Logger(MonitoringController.name);

  // Every queue in the system, including the two apps/api never produces
  // into (SCHEDULE_PUBLISH_CLIP/SYNC_PUBLISH_STATS - see queue.module.ts)
  // - /queues and /workers report on the whole pipeline, not just the
  // queues apps/api happens to be a producer for.
  private readonly queues: { name: QueueName; queue: Queue }[];

  constructor(
    private readonly prisma: PrismaService,
    @InjectQueue(QueueName.IMPORT_YOUTUBE) importYoutubeQueue: Queue,
    @InjectQueue(QueueName.TRANSCRIBE) transcribeQueue: Queue,
    @InjectQueue(QueueName.DETECT_CLIPS) detectClipsQueue: Queue,
    @InjectQueue(QueueName.RENDER_CLIP) renderClipQueue: Queue,
    @InjectQueue(QueueName.PUBLISH_CLIP) publishClipQueue: Queue,
    @InjectQueue(QueueName.SCHEDULE_PUBLISH_CLIP) schedulePublishClipQueue: Queue,
    @InjectQueue(QueueName.SYNC_PUBLISH_STATS) syncPublishStatsQueue: Queue,
  ) {
    this.queues = [
      { name: QueueName.IMPORT_YOUTUBE, queue: importYoutubeQueue },
      { name: QueueName.TRANSCRIBE, queue: transcribeQueue },
      { name: QueueName.DETECT_CLIPS, queue: detectClipsQueue },
      { name: QueueName.RENDER_CLIP, queue: renderClipQueue },
      { name: QueueName.PUBLISH_CLIP, queue: publishClipQueue },
      { name: QueueName.SCHEDULE_PUBLISH_CLIP, queue: schedulePublishClipQueue },
      { name: QueueName.SYNC_PUBLISH_STATS, queue: syncPublishStatsQueue },
    ];
  }

  // Plain JSON, not Prometheus text format - deliberately no metrics
  // library (prom-client/OpenTelemetry) per this project's explicit
  // "lightweight, no large infrastructure" scope. Combines three things
  // that were previously invisible: process-level resource usage (Node
  // built-ins, no dependency), cumulative HTTP request counts (this
  // process only - see metrics-registry.ts's caveat), and a rollup of
  // pipeline health already being recorded in Postgres by the render-graph
  // telemetry (JobExecution/NodeExecution - see
  // apps/worker/src/render-graph/telemetry.ts) and the Video status audit
  // trail (VideoStatusEvent) - reusing that existing data rather than
  // duplicating a parallel metrics path.
  @Get('metrics')
  async metrics() {
    const windowHours = 24;
    const windowStart = new Date(Date.now() - windowHours * 60 * 60 * 1000);

    const [videosByStatusRaw, videoFailures, jobExecutions, nodeExecutionsByStatusRaw] =
      await Promise.all([
        this.prisma.video.groupBy({
          by: ['status'],
          _count: { _all: true },
          where: { updatedAt: { gte: windowStart } },
        }),
        this.prisma.videoStatusEvent.count({
          where: { toStatus: 'FAILED', createdAt: { gte: windowStart } },
        }),
        this.prisma.jobExecution.findMany({
          where: { startedAt: { gte: windowStart }, totalDurationMs: { not: null } },
          select: { totalDurationMs: true },
        }),
        this.prisma.nodeExecution.groupBy({
          by: ['status'],
          _count: { _all: true },
          where: { startedAt: { gte: windowStart } },
        }),
      ]);

    const videosByStatus = Object.fromEntries(
      videosByStatusRaw.map((row) => [row.status, row._count._all]),
    );
    const renderDurations = jobExecutions
      .map((job) => job.totalDurationMs)
      .filter((value): value is number => value !== null);
    const avgRenderDurationMs =
      renderDurations.length > 0
        ? Math.round(
            renderDurations.reduce((sum, value) => sum + value, 0) / renderDurations.length,
          )
        : null;

    const nodeStatusCounts = Object.fromEntries(
      nodeExecutionsByStatusRaw.map((row) => [row.status, row._count._all]),
    );
    const nodeTotal = Object.values(nodeStatusCounts).reduce(
      (sum: number, value) => sum + (value as number),
      0,
    );
    const nodeFailureRate = nodeTotal > 0 ? (nodeStatusCounts.FAILED ?? 0) / nodeTotal : null;

    const memory = process.memoryUsage();
    const cpu = process.cpuUsage();

    return {
      process: {
        uptimeSeconds: Math.round(process.uptime()),
        memory: {
          rssBytes: memory.rss,
          heapUsedBytes: memory.heapUsed,
          heapTotalBytes: memory.heapTotal,
        },
        // cpuUsage() is cumulative since process start (microseconds), not a
        // rate - a caller polling this repeatedly can derive a rate by
        // diffing two snapshots, same convention as Node's own API.
        cpu: { userMs: Math.round(cpu.user / 1000), systemMs: Math.round(cpu.system / 1000) },
      },
      http: metricsRegistry.snapshot(),
      pipeline: {
        windowHours,
        videosByStatus,
        videoFailures,
        renderJobs: { count: renderDurations.length, avgDurationMs: avgRenderDurationMs },
        nodeExecutions: { byStatus: nodeStatusCounts, failureRate: nodeFailureRate },
      },
    };
  }

  @Get('queues')
  async queueSummary(): Promise<Record<string, QueueCounts>> {
    const entries = await Promise.all(
      this.queues.map(async ({ name, queue }): Promise<[QueueName, QueueCounts]> => {
        const raw = await queue.getJobCounts(
          'waiting',
          'active',
          'completed',
          'failed',
          'delayed',
          'paused',
        );
        const likelyStalled = await countLikelyStalled(queue);
        return [
          name,
          {
            waiting: raw.waiting ?? 0,
            active: raw.active ?? 0,
            completed: raw.completed ?? 0,
            failed: raw.failed ?? 0,
            delayed: raw.delayed ?? 0,
            paused: raw.paused ?? 0,
            likelyStalled,
          },
        ];
      }),
    );
    return Object.fromEntries(entries);
  }

  // BullMQ tracks connected workers per queue itself (via Redis client
  // metadata) - this just reports it, rather than building a separate
  // worker-registration mechanism that would duplicate what the queue
  // library already does.
  @Get('workers')
  async workerSummary(): Promise<Record<string, { connected: number }>> {
    const entries = await Promise.all(
      this.queues.map(async ({ name, queue }): Promise<[QueueName, { connected: number }]> => {
        const workers = await queue.getWorkers();
        return [name, { connected: workers.length }];
      }),
    );
    return Object.fromEntries(entries);
  }

  // Non-throwing internal checks - shared by the public @Get routes below
  // (which throw a 503, matching HealthController's posture) and by
  // alerts() (which must observe a down dependency without the whole
  // /alerts response failing). Neither path exposes the raw driver/Prisma/
  // S3-client error string to the client; it's logged server-side instead.
  private async checkStorage(): Promise<
    ({ reachable: true } & Awaited<ReturnType<typeof getBucketUsage>>) | { reachable: false }
  > {
    try {
      await checkStorageConnection();
    } catch (error) {
      this.logger.warn(`storage unreachable: ${error instanceof Error ? error.message : error}`);
      return { reachable: false };
    }
    const usage = await getBucketUsage();
    return { reachable: true, ...usage };
  }

  private async checkDatabase(): Promise<
    { reachable: true; latencyMs: number } | { reachable: false }
  > {
    try {
      const start = Date.now();
      await this.prisma.$queryRaw`SELECT 1`;
      return { reachable: true, latencyMs: Date.now() - start };
    } catch (error) {
      this.logger.warn(`database unreachable: ${error instanceof Error ? error.message : error}`);
      return { reachable: false };
    }
  }

  private async checkRedis(): Promise<
    { reachable: true; latencyMs: number; usedMemoryBytes: number } | { reachable: false }
  > {
    try {
      // Any one of the injected queues works here - they all share the same
      // underlying Redis connection, same reasoning as HealthController.
      // BullMQ's IRedisClient is adapter-agnostic (ioredis in this
      // deployment, but not assumed) and has no ping() - a GET round-trip
      // on a key that will never exist is just as good a latency probe and
      // is part of that shared interface, same as HealthController's
      // reachability check. info() likewise takes no section argument on
      // this interface (unlike ioredis's own client), so it returns the
      // full INFO blob and used_memory is pulled out of that.
      const client = await this.queues[0].queue.client;
      const start = Date.now();
      await client.get('__health_check__');
      const latencyMs = Date.now() - start;
      const info = await client.info();
      const usedMemoryBytes = Number(/used_memory:(\d+)/.exec(info)?.[1] ?? 0);
      return { reachable: true, latencyMs, usedMemoryBytes };
    } catch (error) {
      this.logger.warn(`redis unreachable: ${error instanceof Error ? error.message : error}`);
      return { reachable: false };
    }
  }

  @Get('storage')
  async storageSummary() {
    const result = await this.checkStorage();
    if (!result.reachable) {
      throw new ServiceUnavailableException('Object storage is unreachable');
    }
    return result;
  }

  @Get('database')
  async databaseSummary() {
    const result = await this.checkDatabase();
    if (!result.reachable) {
      throw new ServiceUnavailableException('Database is unreachable');
    }
    return result;
  }

  @Get('redis')
  async redisSummary() {
    const result = await this.checkRedis();
    if (!result.reachable) {
      throw new ServiceUnavailableException('Redis is unreachable');
    }
    return result;
  }

  // Evaluates every alert condition (packages/shared/src/utils/alert-conditions.ts)
  // against the same data the endpoints above already compute - no separate
  // polling path, no external sink (Slack/PagerDuty/etc, explicitly out of
  // scope), just "what's true right now" plus how long each condition has
  // been continuously true (alertStateTracker - see alert-state.ts). This
  // is the foundation the user asked for; wiring a real alerting backend to
  // consume this is a later, separate decision.
  @Get('alerts')
  async alerts() {
    const [queues, workers, database, redis, storage, backups] = await Promise.all([
      this.queueSummary(),
      this.workerSummary(),
      this.checkDatabase(),
      this.checkRedis(),
      this.checkStorage(),
      getBackupStatus(),
    ]);

    const definitions: AlertDefinition[] = [];

    for (const [name, counts] of Object.entries(queues)) {
      if (isQueueBacklogged(counts)) {
        definitions.push({
          id: `queue-backlog:${name}`,
          severity: 'warning',
          message: `Queue "${name}" is backlogged (waiting=${counts.waiting}, active=${counts.active})`,
        });
      }
      if (hasLikelyStalledJobs(counts.likelyStalled)) {
        definitions.push({
          id: `queue-stalled:${name}`,
          severity: 'warning',
          message: `Queue "${name}" has ${counts.likelyStalled} likely-stalled job(s)`,
        });
      }
      if (isFailureRateHigh(counts.failed, counts.completed)) {
        definitions.push({
          id: `queue-failure-rate:${name}`,
          severity: 'warning',
          message: `Queue "${name}" failure rate is high (failed=${counts.failed}, completed=${counts.completed})`,
        });
      }
    }

    for (const [name, worker] of Object.entries(workers)) {
      if (isWorkerOffline(worker.connected)) {
        definitions.push({
          id: `worker-offline:${name}`,
          severity: 'critical',
          message: `No worker connected for queue "${name}"`,
        });
      }
    }

    if (isDependencyDown(database.reachable)) {
      definitions.push({
        id: 'database-unreachable',
        severity: 'critical',
        message: 'Postgres is unreachable',
      });
    }
    if (isDependencyDown(redis.reachable)) {
      definitions.push({
        id: 'redis-unreachable',
        severity: 'critical',
        message: 'Redis is unreachable',
      });
    }
    if (isDependencyDown(storage.reachable)) {
      definitions.push({
        id: 'storage-unreachable',
        severity: 'critical',
        message: 'Object storage is unreachable',
      });
    }

    if (isBackupStale(backups.postgres.stale)) {
      definitions.push({
        id: 'backup-postgres-stale',
        severity: 'critical',
        message: 'Postgres backup is stale, failing, or has never run',
      });
    }
    if (isBackupStale(backups.storage.stale)) {
      definitions.push({
        id: 'backup-storage-stale',
        severity: 'critical',
        message: 'Object-storage backup is stale, failing, or has never run',
      });
    }

    const memory = process.memoryUsage();
    if (isHeapPressureHigh(memory.heapUsed, memory.heapTotal)) {
      definitions.push({
        id: 'heap-pressure',
        severity: 'warning',
        message: 'apps/api heap usage is high',
      });
    }

    return {
      evaluatedAt: new Date().toISOString(),
      thresholds: DEFAULT_ALERT_THRESHOLDS,
      alerts: alertStateTracker.evaluate(definitions),
    };
  }
}
