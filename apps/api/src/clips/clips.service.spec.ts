import { BadRequestException, NotFoundException } from '@nestjs/common';
import { CaptionStyle } from '@viral-clip-app/database';
import { QueueName } from '@viral-clip-app/shared';
import type { Queue } from 'bullmq';
import type { PrismaService } from '../prisma/prisma.service';
import type { SocialAccountsService } from '../social/social.service';
import { ClipsService } from './clips.service';

const PUBLISH_RECORDS_INCLUDE = {
  include: { publishRecords: { include: { socialAccount: true } } },
};

describe('ClipsService', () => {
  let service: ClipsService;
  let prisma: {
    clip: { findUnique: jest.Mock; update: jest.Mock };
    transcriptSegment: { findMany: jest.Mock };
    publishRecord: { create: jest.Mock };
  };
  let socialAccounts: { findOwnedOrThrow: jest.Mock };
  let renderClipQueue: { add: jest.Mock };
  let publishClipQueue: { add: jest.Mock };

  beforeEach(() => {
    prisma = {
      clip: { findUnique: jest.fn(), update: jest.fn() },
      transcriptSegment: { findMany: jest.fn() },
      publishRecord: { create: jest.fn() },
    };
    socialAccounts = { findOwnedOrThrow: jest.fn() };
    renderClipQueue = { add: jest.fn() };
    publishClipQueue = { add: jest.fn() };
    service = new ClipsService(
      prisma as unknown as PrismaService,
      socialAccounts as unknown as SocialAccountsService,
      renderClipQueue as unknown as Queue,
      publishClipQueue as unknown as Queue,
    );
  });

  describe('findRenderedOrThrow', () => {
    it('returns the clip when it belongs to the requester and has finished rendering', async () => {
      const clip = {
        id: 'clip-1',
        outputUrl: 'renders/clip-1.mp4',
        video: { ownerId: 'user-1' },
      };
      prisma.clip.findUnique.mockResolvedValue(clip);

      const result = await service.findRenderedOrThrow('clip-1', 'user-1');

      expect(result).toBe(clip);
    });

    it('throws NotFoundException when the clip does not exist', async () => {
      prisma.clip.findUnique.mockResolvedValue(null);

      await expect(service.findRenderedOrThrow('missing', 'user-1')).rejects.toThrow(
        NotFoundException,
      );
    });

    it('throws NotFoundException when the clip belongs to a different user', async () => {
      prisma.clip.findUnique.mockResolvedValue({
        id: 'clip-1',
        outputUrl: 'renders/clip-1.mp4',
        video: { ownerId: 'someone-else' },
      });

      await expect(service.findRenderedOrThrow('clip-1', 'user-1')).rejects.toThrow(
        NotFoundException,
      );
    });

    it('throws NotFoundException when the clip has not finished rendering yet', async () => {
      prisma.clip.findUnique.mockResolvedValue({
        id: 'clip-1',
        outputUrl: null,
        video: { ownerId: 'user-1' },
      });

      await expect(service.findRenderedOrThrow('clip-1', 'user-1')).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('update', () => {
    const existingClip = {
      id: 'clip-1',
      videoId: 'video-1',
      startTime: 10,
      endTime: 20,
      viralityScore: 80,
      outputUrl: 'renders/clip-1.mp4',
      captionStyle: 'DEFAULT',
      hookText: 'Wait for it...',
      hashtags: ['viral', 'fyp'],
      publishRecords: [],
      updatedAt: new Date('2026-01-01'),
      video: { ownerId: 'user-1' },
    };

    it('updates startTime and endTime and returns a downloadUrl-mapped dto', async () => {
      prisma.clip.findUnique.mockResolvedValue(existingClip);
      prisma.clip.update.mockResolvedValue({ ...existingClip, startTime: 12, endTime: 22 });

      const result = await service.update('clip-1', 'user-1', { startTime: 12, endTime: 22 });

      expect(prisma.clip.update).toHaveBeenCalledWith({
        where: { id: 'clip-1' },
        data: {
          startTime: 12,
          endTime: 22,
          captionStyle: 'DEFAULT',
          hookText: 'Wait for it...',
          hashtags: ['viral', 'fyp'],
        },
        ...PUBLISH_RECORDS_INCLUDE,
      });
      expect(result).toEqual({
        id: 'clip-1',
        videoId: 'video-1',
        startTime: 12,
        endTime: 22,
        viralityScore: 80,
        downloadUrl: '/clips/clip-1/download',
        captionStyle: 'DEFAULT',
        hookText: 'Wait for it...',
        hashtags: ['viral', 'fyp'],
        publishRecords: [],
        updatedAt: existingClip.updatedAt,
      });
    });

    it('allows updating just one field, validating against the other current value', async () => {
      prisma.clip.findUnique.mockResolvedValue(existingClip);
      prisma.clip.update.mockResolvedValue({ ...existingClip, endTime: 25 });

      await service.update('clip-1', 'user-1', { endTime: 25 });

      expect(prisma.clip.update).toHaveBeenCalledWith({
        where: { id: 'clip-1' },
        data: {
          startTime: 10,
          endTime: 25,
          captionStyle: 'DEFAULT',
          hookText: 'Wait for it...',
          hashtags: ['viral', 'fyp'],
        },
        ...PUBLISH_RECORDS_INCLUDE,
      });
    });

    it('updates captionStyle independently of startTime/endTime', async () => {
      prisma.clip.findUnique.mockResolvedValue(existingClip);
      prisma.clip.update.mockResolvedValue({ ...existingClip, captionStyle: 'KARAOKE' });

      await service.update('clip-1', 'user-1', { captionStyle: CaptionStyle.KARAOKE });

      expect(prisma.clip.update).toHaveBeenCalledWith({
        where: { id: 'clip-1' },
        data: {
          startTime: 10,
          endTime: 20,
          captionStyle: 'KARAOKE',
          hookText: 'Wait for it...',
          hashtags: ['viral', 'fyp'],
        },
        ...PUBLISH_RECORDS_INCLUDE,
      });
    });

    it('updates hookText and hashtags independently of startTime/endTime/captionStyle', async () => {
      prisma.clip.findUnique.mockResolvedValue(existingClip);
      prisma.clip.update.mockResolvedValue({
        ...existingClip,
        hookText: 'New hook',
        hashtags: ['newtag'],
      });

      await service.update('clip-1', 'user-1', { hookText: 'New hook', hashtags: ['newtag'] });

      expect(prisma.clip.update).toHaveBeenCalledWith({
        where: { id: 'clip-1' },
        data: {
          startTime: 10,
          endTime: 20,
          captionStyle: 'DEFAULT',
          hookText: 'New hook',
          hashtags: ['newtag'],
        },
        ...PUBLISH_RECORDS_INCLUDE,
      });
    });

    it('sanitizes hashtags (strips leading "#" and blanks) on manual edit, same as detect-clips', async () => {
      prisma.clip.findUnique.mockResolvedValue(existingClip);
      prisma.clip.update.mockResolvedValue(existingClip);

      await service.update('clip-1', 'user-1', { hashtags: ['#viral', ' fyp ', '', '#foryou'] });

      expect(prisma.clip.update).toHaveBeenCalledWith({
        where: { id: 'clip-1' },
        data: expect.objectContaining({ hashtags: ['viral', 'fyp', 'foryou'] }),
        ...PUBLISH_RECORDS_INCLUDE,
      });
    });

    it('throws BadRequestException when startTime would not be before endTime', async () => {
      prisma.clip.findUnique.mockResolvedValue(existingClip);

      await expect(service.update('clip-1', 'user-1', { startTime: 25 })).rejects.toThrow(
        BadRequestException,
      );
      expect(prisma.clip.update).not.toHaveBeenCalled();
    });

    it('throws NotFoundException when the clip belongs to a different user', async () => {
      prisma.clip.findUnique.mockResolvedValue({
        ...existingClip,
        video: { ownerId: 'someone-else' },
      });

      await expect(service.update('clip-1', 'user-1', { startTime: 12 })).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('render', () => {
    const clip = {
      id: 'clip-1',
      videoId: 'video-1',
      startTime: 10,
      endTime: 20,
      viralityScore: 80,
      outputUrl: 'renders/clip-1.mp4',
      captionStyle: CaptionStyle.KARAOKE,
      hookText: 'Wait for it...',
      hashtags: ['viral', 'fyp'],
      publishRecords: [],
      updatedAt: new Date('2026-01-01'),
      video: { ownerId: 'user-1', sourceUrl: 'videos/abc.mp4' },
    };

    it('clears outputUrl, enqueues render-clip with the recomputed transcript and captionStyle, and returns the cleared dto', async () => {
      prisma.clip.findUnique.mockResolvedValue(clip);
      const segments = [
        { start: 0, end: 5, text: 'before', words: null },
        { start: 12, end: 18, text: 'inside', words: [{ word: 'inside', start: 12, end: 12.5 }] },
      ];
      prisma.transcriptSegment.findMany.mockResolvedValue(segments);
      const cleared = { ...clip, outputUrl: null, updatedAt: new Date('2026-01-02') };
      prisma.clip.update.mockResolvedValue(cleared);

      const result = await service.render('clip-1', 'user-1');

      expect(prisma.clip.update).toHaveBeenCalledWith({
        where: { id: 'clip-1' },
        data: { outputUrl: null },
        ...PUBLISH_RECORDS_INCLUDE,
      });
      expect(renderClipQueue.add).toHaveBeenCalledWith(QueueName.RENDER_CLIP, {
        clipId: 'clip-1',
        videoId: 'video-1',
        sourceUrl: 'videos/abc.mp4',
        startTime: 10,
        endTime: 20,
        transcript: [
          {
            start: 12,
            end: 18,
            text: 'inside',
            words: [{ word: 'inside', start: 12, end: 12.5 }],
          },
        ],
        captionStyle: CaptionStyle.KARAOKE,
      });
      expect(result).toEqual({
        id: 'clip-1',
        videoId: 'video-1',
        startTime: 10,
        endTime: 20,
        viralityScore: 80,
        downloadUrl: null,
        captionStyle: CaptionStyle.KARAOKE,
        hookText: 'Wait for it...',
        hashtags: ['viral', 'fyp'],
        publishRecords: [],
        updatedAt: cleared.updatedAt,
      });
    });

    it('throws NotFoundException when the clip belongs to a different user', async () => {
      prisma.clip.findUnique.mockResolvedValue({
        ...clip,
        video: { ...clip.video, ownerId: 'someone-else' },
      });

      await expect(service.render('clip-1', 'user-1')).rejects.toThrow(NotFoundException);
      expect(renderClipQueue.add).not.toHaveBeenCalled();
    });
  });

  describe('publish', () => {
    const renderedClip = {
      id: 'clip-1',
      outputUrl: 'renders/clip-1.mp4',
      video: { ownerId: 'user-1' },
    };
    const account = { id: 'account-1', userId: 'user-1' };
    const createdRecord = {
      id: 'record-1',
      clipId: 'clip-1',
      socialAccountId: 'account-1',
      status: 'QUEUED',
      platformPostId: null,
      errorMessage: null,
      publishedAt: null,
      createdAt: new Date('2026-01-01'),
      socialAccount: { platform: 'YOUTUBE' },
    };

    it('creates a PublishRecord, enqueues publish-clip with retry options, and returns the shared dto', async () => {
      prisma.clip.findUnique.mockResolvedValue(renderedClip);
      socialAccounts.findOwnedOrThrow.mockResolvedValue(account);
      prisma.publishRecord.create.mockResolvedValue(createdRecord);

      const result = await service.publish('clip-1', 'user-1', { socialAccountId: 'account-1' });

      expect(socialAccounts.findOwnedOrThrow).toHaveBeenCalledWith('account-1', 'user-1');
      expect(prisma.publishRecord.create).toHaveBeenCalledWith({
        data: { clipId: 'clip-1', socialAccountId: 'account-1' },
        include: { socialAccount: true },
      });
      expect(publishClipQueue.add).toHaveBeenCalledWith(
        QueueName.PUBLISH_CLIP,
        { publishRecordId: 'record-1' },
        { attempts: 3, backoff: { type: 'exponential', delay: 30_000 } },
      );
      expect(result).toEqual({
        id: 'record-1',
        clipId: 'clip-1',
        socialAccountId: 'account-1',
        platform: 'YOUTUBE',
        status: 'QUEUED',
        platformPostId: null,
        errorMessage: null,
        publishedAt: null,
        createdAt: createdRecord.createdAt.toISOString(),
      });
    });

    it('throws NotFoundException when the clip has not finished rendering yet', async () => {
      prisma.clip.findUnique.mockResolvedValue({ ...renderedClip, outputUrl: null });

      await expect(
        service.publish('clip-1', 'user-1', { socialAccountId: 'account-1' }),
      ).rejects.toThrow(NotFoundException);
      expect(socialAccounts.findOwnedOrThrow).not.toHaveBeenCalled();
      expect(publishClipQueue.add).not.toHaveBeenCalled();
    });

    it('propagates NotFoundException when the social account is not owned by the requester', async () => {
      prisma.clip.findUnique.mockResolvedValue(renderedClip);
      socialAccounts.findOwnedOrThrow.mockRejectedValue(
        new NotFoundException('Social account account-1 not found'),
      );

      await expect(
        service.publish('clip-1', 'user-1', { socialAccountId: 'account-1' }),
      ).rejects.toThrow(NotFoundException);
      expect(prisma.publishRecord.create).not.toHaveBeenCalled();
      expect(publishClipQueue.add).not.toHaveBeenCalled();
    });
  });
});
