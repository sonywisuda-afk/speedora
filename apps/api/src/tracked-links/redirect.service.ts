import { createHash } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { isBotUserAgent } from './bot-detection.util';
import { ClickDedupService } from './click-dedup.service';

const DEDUP_WINDOW_SECONDS = 5;
const MAX_REFERRER_LENGTH = 512;

// IP + User-Agent are hashed and used ONLY to build this short-lived Redis
// dedup key - never persisted anywhere, never logged, expires within
// DEDUP_WINDOW_SECONDS. This is the one place in this app that reads a raw
// client IP for click-tracking, and it never reaches Postgres or any
// durable store - see TrackedLinkClick's own schema comment for the
// durable-storage side of this privacy posture (no IP column, no raw
// User-Agent column at all).
function buildDedupKey(trackedLinkId: string, ip: string, userAgent: string | undefined): string {
  const hash = createHash('sha256')
    .update(`${ip}:${userAgent ?? ''}`)
    .digest('hex')
    .slice(0, 16);
  return `click-dedup:${trackedLinkId}:${hash}`;
}

export interface ClickContext {
  ip: string;
  userAgent: string | undefined;
  referrer: string | undefined;
}

@Injectable()
export class RedirectService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly dedup: ClickDedupService,
  ) {}

  // Returns the destination URL to redirect to, or null if the slug
  // doesn't exist (RedirectController turns that into a 404). Low-latency
  // by design: at most one indexed unique-slug lookup, one Redis SET NX,
  // and one small transactional write pair - nothing here does
  // synchronous work heavier than that, so the redirect itself is never
  // meaningfully delayed.
  async recordClickAndResolve(slug: string, ctx: ClickContext): Promise<string | null> {
    const link = await this.prisma.trackedLink.findUnique({
      where: { slug },
      select: { id: true, destinationUrl: true },
    });
    if (!link) return null;

    const dedupKey = buildDedupKey(link.id, ctx.ip, ctx.userAgent);
    const isFirstOccurrence = await this.dedup.isFirstOccurrence(dedupKey, DEDUP_WINDOW_SECONDS);

    if (isFirstOccurrence) {
      const isBot = isBotUserAgent(ctx.userAgent);
      const referrer = ctx.referrer?.slice(0, MAX_REFERRER_LENGTH) ?? null;

      // Scalability note: at click volumes far beyond what this app
      // operates at today, this synchronous write pair would move behind
      // a queued job (BullMQ is already wired for exactly this kind of
      // decoupling elsewhere in this app) so the redirect itself never
      // waits on Postgres at all. Not done here - a single indexed
      // transactional write pair is comfortably fast at any volume this
      // app is actually seeing, and queueing it now would be complexity
      // with no present benefit (see this project's recurring "don't
      // over-engineer ahead of a real need" instruction).
      await this.prisma.$transaction([
        this.prisma.trackedLinkClick.create({
          data: { trackedLinkId: link.id, referrer, isBot },
        }),
        // clickCount only ever counts real (non-bot) clicks - see
        // TrackedLink.clickCount's own schema comment.
        ...(isBot
          ? []
          : [
              this.prisma.trackedLink.update({
                where: { id: link.id },
                data: { clickCount: { increment: 1 } },
              }),
            ]),
      ]);
    }

    return link.destinationUrl;
  }
}
