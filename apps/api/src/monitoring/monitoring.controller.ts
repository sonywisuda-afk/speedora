import { InjectQueue } from '@nestjs/bullmq';
import { Controller, Get, Logger, ServiceUnavailableException } from '@nestjs/common';
import {
  computeAvgProcessingTimeMs,
  computeFailureRate,
  countRetriedJobs,
  DEFAULT_ALERT_THRESHOLDS,
  hasLikelyStalledJobs,
  isBackupStale,
  isDependencyDown,
  isFailureRateHigh,
  isHeapPressureHigh,
  isQueueBacklogged,
  isWorkerOffline,
  heartbeatKeyPattern,
  QueueName,
  readVideoImportMetrics,
  type RedisLike,
} from '@speedora/shared';
import { checkStorageConnection, getBucketUsage } from '@speedora/storage';
import type { Queue } from 'bullmq';
import type { Redis } from 'ioredis';
import { getBackupStatus } from '../health/backup-status';
import { PrismaService } from '../prisma/prisma.service';
import { alertStateTracker, type AlertDefinition } from './alert-state';
import { metricsRegistry } from './metrics-registry';
import {
  buildWorkerHealthEntry,
  parseHeartbeatPayload,
  type WorkerHealthEntry,
} from './worker-heartbeat-reader';

// A request stuck in 'active' this long with no progress is worth flagging
// even though BullMQ's own stalled-job recovery (maxStalledCount, on the
// Worker side) already handles the actual recovery - this is purely a
// visibility signal for GET /queues, not a replacement for that mechanism.
const LIKELY_STALLED_THRESHOLD_MS = 5 * 60 * 1000;
// Bounds the cost of the stalled-job check below to a fixed amount of work
// regardless of how many jobs are active - an operational endpoint should
// never itself become a slow query against Redis.
const MAX_ACTIVE_JOBS_TO_INSPECT = 100;
// Oracle Cloud Free hybrid deployment (Fase 3 - Queue Metrics) - same
// bounded-sample reasoning as MAX_ACTIVE_JOBS_TO_INSPECT above, applied to
// completed/failed jobs for avgProcessingTimeMs/retriedJobs. Lower than the
// active-job limit since this endpoint now does two extra getJobs() calls
// per queue (completed AND failed) instead of one.
const MAX_RECENT_JOBS_TO_INSPECT = 50;

async function countLikelyStalled(queue: Queue): Promise<number> {
  const active = await queue.getJobs(['active'], 0, MAX_ACTIVE_JOBS_TO_INSPECT - 1);
  const now = Date.now();
  return active.filter(
    (job) => job.processedOn && now - job.processedOn > LIKELY_STALLED_THRESHOLD_MS,
  ).length;
}

async function computeRecentJobMetrics(
  queue: Queue,
): Promise<{ avgProcessingTimeMs: number | null; retriedJobs: number }> {
  const [completed, failed] = await Promise.all([
    queue.getJobs(['completed'], 0, MAX_RECENT_JOBS_TO_INSPECT - 1),
    queue.getJobs(['failed'], 0, MAX_RECENT_JOBS_TO_INSPECT - 1),
  ]);

  return {
    avgProcessingTimeMs: computeAvgProcessingTimeMs(completed),
    retriedJobs: countRetriedJobs([...completed, ...failed]),
  };
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
  // Oracle Cloud Free hybrid deployment (Fase 3 - Queue Metrics) -
  // failureRate is computed from the full getJobCounts() totals above (no
  // extra Redis calls); avgProcessingTimeMs/retriedJobs are necessarily
  // sampled (see computeRecentJobMetrics) since BullMQ doesn't expose them
  // as O(1) aggregates the way waiting/active/completed/failed are.
  failureRate: number | null;
  avgProcessingTimeMs: number | null;
  retriedJobs: number;
}

// Every route below is unauthenticated and unthrottled on purpose - same
// posture as HealthController's own /health, documented in full in
// docs/monitoring.md ("a load balancer, uptime checker, or on-call engineer
// needs to reach them without a session, and none of them return video/user
// data, only operational numbers"). Not an oversight - do not add a guard
// here without revisiting that doc first.
@Controller()
export class MonitoringController {
  private readonly logger = new Logger(MonitoringController.name);

  // Every queue in the system - /queues, /workers, and /workers/health
  // report on the whole pipeline, not just the queues apps/api happens to
  // be a producer for. Oracle Cloud Free hybrid deployment (Fase 3 - Queue
  // Metrics) completed this list to all 16: PROBE_VIDEO, EXPORT_GENERATE,
  // NOTIFICATION_DELIVERY, GENERATE_PLATFORM_COPY, TRANSLATE_TRANSCRIPT, and
  // GENERATE_MORE_CLIPS were already registered in queue.module.ts but not
  // injected here; ALERT_ENGINE/SYNC_FOLLOWER_COUNT/TELEGRAM_CHAT_DISCOVERY
  // needed registering there too (see that file's own comment). PR #45
  // (Production Metrics Collection) added the 17th, METRICS_SNAPSHOT.
  private readonly queues: { name: QueueName; queue: Queue }[];

  constructor(
    private readonly prisma: PrismaService,
    @InjectQueue(QueueName.IMPORT_YOUTUBE) importYoutubeQueue: Queue,
    @InjectQueue(QueueName.PROBE_VIDEO) probeVideoQueue: Queue,
    @InjectQueue(QueueName.TRANSCRIBE) transcribeQueue: Queue,
    @InjectQueue(QueueName.DETECT_CLIPS) detectClipsQueue: Queue,
    @InjectQueue(QueueName.GENERATE_MORE_CLIPS) generateMoreClipsQueue: Queue,
    @InjectQueue(QueueName.RENDER_CLIP) renderClipQueue: Queue,
    @InjectQueue(QueueName.PUBLISH_CLIP) publishClipQueue: Queue,
    @InjectQueue(QueueName.SCHEDULE_PUBLISH_CLIP) schedulePublishClipQueue: Queue,
    @InjectQueue(QueueName.SYNC_PUBLISH_STATS) syncPublishStatsQueue: Queue,
    @InjectQueue(QueueName.SYNC_FOLLOWER_COUNT) syncFollowerCountQueue: Queue,
    @InjectQueue(QueueName.EXPORT_GENERATE) exportGenerateQueue: Queue,
    @InjectQueue(QueueName.NOTIFICATION_DELIVERY) notificationDeliveryQueue: Queue,
    @InjectQueue(QueueName.GENERATE_PLATFORM_COPY) generatePlatformCopyQueue: Queue,
    @InjectQueue(QueueName.TRANSLATE_TRANSCRIPT) translateTranscriptQueue: Queue,
    @InjectQueue(QueueName.ALERT_ENGINE) alertEngineQueue: Queue,
    @InjectQueue(QueueName.TELEGRAM_CHAT_DISCOVERY) telegramChatDiscoveryQueue: Queue,
    @InjectQueue(QueueName.METRICS_SNAPSHOT) metricsSnapshotQueue: Queue,
  ) {
    this.queues = [
      { name: QueueName.IMPORT_YOUTUBE, queue: importYoutubeQueue },
      { name: QueueName.PROBE_VIDEO, queue: probeVideoQueue },
      { name: QueueName.TRANSCRIBE, queue: transcribeQueue },
      { name: QueueName.DETECT_CLIPS, queue: detectClipsQueue },
      { name: QueueName.GENERATE_MORE_CLIPS, queue: generateMoreClipsQueue },
      { name: QueueName.RENDER_CLIP, queue: renderClipQueue },
      { name: QueueName.PUBLISH_CLIP, queue: publishClipQueue },
      { name: QueueName.SCHEDULE_PUBLISH_CLIP, queue: schedulePublishClipQueue },
      { name: QueueName.SYNC_PUBLISH_STATS, queue: syncPublishStatsQueue },
      { name: QueueName.SYNC_FOLLOWER_COUNT, queue: syncFollowerCountQueue },
      { name: QueueName.EXPORT_GENERATE, queue: exportGenerateQueue },
      { name: QueueName.NOTIFICATION_DELIVERY, queue: notificationDeliveryQueue },
      { name: QueueName.GENERATE_PLATFORM_COPY, queue: generatePlatformCopyQueue },
      { name: QueueName.TRANSLATE_TRANSCRIPT, queue: translateTranscriptQueue },
      { name: QueueName.ALERT_ENGINE, queue: alertEngineQueue },
      { name: QueueName.TELEGRAM_CHAT_DISCOVERY, queue: telegramChatDiscoveryQueue },
      { name: QueueName.METRICS_SNAPSHOT, queue: metricsSnapshotQueue },
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

    const [
      videosByStatusRaw,
      videoFailures,
      jobExecutions,
      nodeExecutionsByStatusRaw,
      videoImport,
    ] = await Promise.all([
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
      // Cross-process, all-time counters written by apps/worker's
      // import-youtube.worker.ts after every import (see
      // @speedora/shared's video-import-metrics.ts) - reuses the same
      // shared Redis client checkRedis() already pulls off this queue, no
      // new connection. BullMQ's own IRedisClient type doesn't declare
      // incr/incrby/hincrby even though the real ioredis client backing it
      // (this deployment's only adapter) has them - same gap checkRedis()
      // works around for .info(), cast here instead of widening RedisLike
      // to match bullmq's narrower declared surface.
      this.queues[0].queue.client.then((client) =>
        readVideoImportMetrics(client as unknown as RedisLike),
      ),
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
      // All-time (not windowed like the pipeline section above) - matches
      // VideoImportMetricsSnapshot's own "all-time counters" framing, see
      // video-import-metrics.ts.
      videoImport: {
        totalImports: videoImport.totalImports,
        successfulImports: videoImport.successfulImports,
        failedImports: videoImport.failedImports,
        successRate: videoImport.successRate,
        retryCount: videoImport.retryCount,
        avgDurationMs: videoImport.avgDurationMs,
        timeoutCount: videoImport.timeoutCount,
        cancellationCount: videoImport.cancellationCount,
        failuresByCategory: videoImport.failuresByCategory,
        engineName: videoImport.engineName,
        engineVersion: videoImport.engineVersion,
        engineHealthStatus: videoImport.engineHealthStatus,
        lastSuccessfulImportAt: videoImport.lastSuccessfulImportAt,
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
        const completed = raw.completed ?? 0;
        const failed = raw.failed ?? 0;
        const [likelyStalled, recentJobMetrics] = await Promise.all([
          countLikelyStalled(queue),
          computeRecentJobMetrics(queue),
        ]);
        return [
          name,
          {
            waiting: raw.waiting ?? 0,
            active: raw.active ?? 0,
            completed,
            failed,
            delayed: raw.delayed ?? 0,
            paused: raw.paused ?? 0,
            likelyStalled,
            failureRate: computeFailureRate(failed, completed),
            avgProcessingTimeMs: recentJobMetrics.avgProcessingTimeMs,
            retriedJobs: recentJobMetrics.retriedJobs,
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

  // Oracle Cloud Free hybrid deployment (Fase 3 - Health Endpoint) -
  // per-WORKER-PROCESS visibility (e.g. "is worker-render alive, and what's
  // its actual queue backlog"), which workerSummary() above can't answer -
  // that endpoint reports per-QUEUE connected-client counts, not "here is
  // process X and everything assigned to it". Reads the Redis heartbeats
  // apps/worker/src/workerHeartbeat.ts writes (apps/worker has no HTTP
  // server of its own, see CLAUDE.md, so this is how apps/api learns about
  // it) rather than building a second worker-registration mechanism.
  //
  // KEYS, not SCAN - safe here because cardinality is bounded by the number
  // of worker PROCESSES (single digits to low tens even at scale), not a
  // general Redis keyspace scan; this is the same judgment call
  // checkRedis() below already makes for a single '__health_check__' GET.
  @Get('workers/health')
  async workersHealth(): Promise<WorkerHealthEntry[]> {
    // BullMQ's own IRedisClient type doesn't declare keys()/ttl() even
    // though the real ioredis client backing it (this deployment's only
    // adapter) has them - same gap metrics()'s readVideoImportMetrics()
    // call above works around, same cast.
    const client = (await this.queues[0].queue.client) as unknown as Redis;
    const keys = await client.keys(heartbeatKeyPattern());
    if (keys.length === 0) return [];

    const [values, ttls] = await Promise.all([
      Promise.all(keys.map((key) => client.get(key))),
      Promise.all(keys.map((key) => client.ttl(key))),
    ]);

    const jobCountsByQueue = new Map(
      await Promise.all(
        this.queues.map(
          async ({ name, queue }): Promise<[QueueName, { active: number; waiting: number }]> => {
            const counts = await queue.getJobCounts('active', 'waiting');
            return [name, { active: counts.active ?? 0, waiting: counts.waiting ?? 0 }];
          },
        ),
      ),
    );

    const entries: WorkerHealthEntry[] = [];
    for (let i = 0; i < values.length; i++) {
      const payload = parseHeartbeatPayload(values[i]);
      // A key can expire between the KEYS scan above and this GET (both
      // TTL-based) - skip that one entry rather than fail the whole
      // response over a worker that just happened to go quiet mid-request.
      if (!payload) continue;
      entries.push(buildWorkerHealthEntry(payload, ttls[i], jobCountsByQueue));
    }
    return entries;
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
