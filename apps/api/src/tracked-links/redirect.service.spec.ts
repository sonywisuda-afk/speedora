import type { ClickDedupService } from './click-dedup.service';
import type { PrismaService } from '../prisma/prisma.service';
import { RedirectService } from './redirect.service';

describe('RedirectService', () => {
  let service: RedirectService;
  let prisma: {
    trackedLink: { findUnique: jest.Mock; update: jest.Mock };
    trackedLinkClick: { create: jest.Mock };
    $transaction: jest.Mock;
  };
  let dedup: { isFirstOccurrence: jest.Mock };

  const link = { id: 'link-1', destinationUrl: 'https://creator.example/landing' };

  beforeEach(() => {
    prisma = {
      trackedLink: { findUnique: jest.fn(), update: jest.fn() },
      trackedLinkClick: { create: jest.fn() },
      $transaction: jest.fn().mockResolvedValue(undefined),
    };
    dedup = { isFirstOccurrence: jest.fn() };

    service = new RedirectService(prisma as unknown as PrismaService, dedup as unknown as ClickDedupService);
  });

  it('returns null for an unknown slug - RedirectController turns this into a 404', async () => {
    prisma.trackedLink.findUnique.mockResolvedValue(null);

    const result = await service.recordClickAndResolve('missing-slug', {
      ip: '1.2.3.4',
      userAgent: 'Mozilla/5.0',
      referrer: undefined,
    });

    expect(result).toBeNull();
    expect(dedup.isFirstOccurrence).not.toHaveBeenCalled();
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('resolves the destination URL and records a real (non-bot) click on first occurrence', async () => {
    prisma.trackedLink.findUnique.mockResolvedValue(link);
    dedup.isFirstOccurrence.mockResolvedValue(true);

    const result = await service.recordClickAndResolve('abc123', {
      ip: '1.2.3.4',
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/120.0.0.0',
      referrer: 'https://twitter.com/some/post',
    });

    expect(result).toBe(link.destinationUrl);
    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    const transactionOps = prisma.$transaction.mock.calls[0][0];
    expect(transactionOps).toHaveLength(2);
    expect(prisma.trackedLinkClick.create).toHaveBeenCalledWith({
      data: { trackedLinkId: link.id, referrer: 'https://twitter.com/some/post', isBot: false },
    });
    expect(prisma.trackedLink.update).toHaveBeenCalledWith({
      where: { id: link.id },
      data: { clickCount: { increment: 1 } },
    });
  });

  it('resolves the destination URL but does not increment clickCount for a bot click', async () => {
    prisma.trackedLink.findUnique.mockResolvedValue(link);
    dedup.isFirstOccurrence.mockResolvedValue(true);

    const result = await service.recordClickAndResolve('abc123', {
      ip: '1.2.3.4',
      userAgent: 'Slackbot-LinkExpanding 1.0',
      referrer: undefined,
    });

    expect(result).toBe(link.destinationUrl);
    const transactionOps = prisma.$transaction.mock.calls[0][0];
    expect(transactionOps).toHaveLength(1);
    expect(prisma.trackedLinkClick.create).toHaveBeenCalledWith({
      data: { trackedLinkId: link.id, referrer: null, isBot: true },
    });
    expect(prisma.trackedLink.update).not.toHaveBeenCalled();
  });

  it('resolves the destination URL but skips recording a duplicate click within the dedup window', async () => {
    prisma.trackedLink.findUnique.mockResolvedValue(link);
    dedup.isFirstOccurrence.mockResolvedValue(false);

    const result = await service.recordClickAndResolve('abc123', {
      ip: '1.2.3.4',
      userAgent: 'Mozilla/5.0',
      referrer: undefined,
    });

    expect(result).toBe(link.destinationUrl);
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('truncates an overlong referrer before persisting it', async () => {
    prisma.trackedLink.findUnique.mockResolvedValue(link);
    dedup.isFirstOccurrence.mockResolvedValue(true);
    const longReferrer = 'https://example.com/' + 'a'.repeat(1000);

    await service.recordClickAndResolve('abc123', {
      ip: '1.2.3.4',
      userAgent: 'Mozilla/5.0',
      referrer: longReferrer,
    });

    const createCall = prisma.trackedLinkClick.create.mock.calls[0][0];
    expect(createCall.data.referrer).toHaveLength(512);
  });

  it('derives the same dedup key for the same IP+UA pair and different keys for different pairs', async () => {
    prisma.trackedLink.findUnique.mockResolvedValue(link);
    dedup.isFirstOccurrence.mockResolvedValue(true);

    await service.recordClickAndResolve('abc123', { ip: '1.2.3.4', userAgent: 'Mozilla/5.0', referrer: undefined });
    await service.recordClickAndResolve('abc123', { ip: '1.2.3.4', userAgent: 'Mozilla/5.0', referrer: undefined });
    await service.recordClickAndResolve('abc123', { ip: '9.9.9.9', userAgent: 'Mozilla/5.0', referrer: undefined });

    const [firstKey, windowSeconds] = dedup.isFirstOccurrence.mock.calls[0];
    const [secondKey] = dedup.isFirstOccurrence.mock.calls[1];
    const [thirdKey] = dedup.isFirstOccurrence.mock.calls[2];

    expect(firstKey).toBe(secondKey);
    expect(firstKey).not.toBe(thirdKey);
    expect(firstKey).toContain(`click-dedup:${link.id}:`);
    expect(windowSeconds).toBe(5);
  });
});
