import { PublishStatus } from '@speedora/database';
import { PUBLISH_RETRY_OPTIONS, QueueName } from '@speedora/shared';
import { Worker } from 'bullmq';
import { prisma } from '../prisma';
import { publishClipQueue, schedulePublishClipQueue } from '../queues';
import { createRedisConnection } from '../redis';

// Ceiling on how late a scheduled publish can actually fire relative to its
// scheduledAt - worst case, it just missed a poll and waits almost a full
// interval. Postgres (not BullMQ's delayed-job set) is the source of truth
// for what's scheduled, consistent with this project's "Postgres for
// durable state, Redis just for queues/cache" rule - a Redis data loss
// can't silently drop a scheduled publish, only delay it until the next
// successful poll after Redis (and the repeatable trigger below) recovers.
const POLL_INTERVAL_MS = 60_000;

const SCHEDULE_TRIGGER_JOB_ID = 'schedule-publish-clip-poll';

// Registers the single repeatable trigger that fires this worker's
// processor every POLL_INTERVAL_MS - called once at startup (see main.ts).
// Idempotent: BullMQ dedupes a repeatable job by its repeat key (name +
// pattern/every + jobId), so calling this again on every worker restart
// doesn't create duplicate repeating jobs.
export async function scheduleRepeatingTrigger(): Promise<void> {
  await schedulePublishClipQueue.add(
    QueueName.SCHEDULE_PUBLISH_CLIP,
    {},
    { repeat: { every: POLL_INTERVAL_MS }, jobId: SCHEDULE_TRIGGER_JOB_ID },
  );
}

export function createSchedulePublishClipWorker(): Worker {
  return new Worker(
    QueueName.SCHEDULE_PUBLISH_CLIP,
    async () => {
      const due = await prisma.publishRecord.findMany({
        where: { status: PublishStatus.SCHEDULED, scheduledAt: { lte: new Date() } },
        select: { id: true },
      });

      let claimed = 0;
      for (const { id } of due) {
        // Atomic claim via the WHERE status=SCHEDULED guard - safe even if
        // two poll firings somehow overlap (e.g. a slow previous run still
        // finishing when the next repeat fires), since only one updateMany
        // can flip a given row from SCHEDULED to QUEUED.
        const result = await prisma.publishRecord.updateMany({
          where: { id, status: PublishStatus.SCHEDULED },
          data: { status: PublishStatus.QUEUED },
        });
        if (result.count === 1) {
          await publishClipQueue.add(
            QueueName.PUBLISH_CLIP,
            { publishRecordId: id },
            PUBLISH_RETRY_OPTIONS,
          );
          claimed += 1;
        }
      }

      if (claimed > 0) {
        console.log(`[schedule-publish-clip] claimed and enqueued ${claimed} due record(s)`);
      }
    },
    { connection: createRedisConnection() },
  );
}
