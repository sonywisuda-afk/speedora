import { BadRequestException, NotFoundException } from '@nestjs/common';
import { CaptionStyle } from '@speedora/database';
import { QueueName } from '@speedora/shared';
import type { Queue } from 'bullmq';
import type { PrismaService } from '../prisma/prisma.service';
import type { SocialAccountsService } from '../social/social.service';
import type { StorageService } from '../storage/storage.service';
import { ClipsService } from './clips.service';

const PUBLISH_RECORDS_INCLUDE = {
  include: { publishRecords: { include: { socialAccount: true } } },
};

describe('ClipsService', () => {
  let service: ClipsService;
  let prisma: {
    clip: { findUnique: jest.Mock; update: jest.Mock; delete: jest.Mock };
    transcriptSegment: { findMany: jest.Mock };
    publishRecord: {
      create: jest.Mock;
      deleteMany: jest.Mock;
      updateMany: jest.Mock;
      findUniqueOrThrow: jest.Mock;
    };
  };
  let socialAccounts: { findOwnedOrThrow: jest.Mock };
  let storage: { deleteObjects: jest.Mock };
  let renderClipQueue: { add: jest.Mock };
  let publishClipQueue: { add: jest.Mock };

  beforeEach(() => {
    prisma = {
      clip: { findUnique: jest.fn(), update: jest.fn(), delete: jest.fn().mockResolvedValue({}) },
      transcriptSegment: { findMany: jest.fn() },
      publishRecord: {
        create: jest.fn(),
        deleteMany: jest.fn(),
        updateMany: jest.fn(),
        findUniqueOrThrow: jest.fn(),
      },
    };
    socialAccounts = { findOwnedOrThrow: jest.fn() };
    storage = { deleteObjects: jest.fn().mockResolvedValue(undefined) };
    renderClipQueue = { add: jest.fn() };
    publishClipQueue = { add: jest.fn() };
    service = new ClipsService(
      prisma as unknown as PrismaService,
      socialAccounts as unknown as SocialAccountsService,
      storage as unknown as StorageService,
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

  describe('findThumbnailOrThrow', () => {
    it('returns the thumbnailUrl when the clip belongs to the requester and has one', async () => {
      prisma.clip.findUnique.mockResolvedValue({
        id: 'clip-1',
        thumbnailUrl: 'thumbnails/clip-1.jpg',
        video: { ownerId: 'user-1' },
      });

      const result = await service.findThumbnailOrThrow('clip-1', 'user-1');

      expect(result).toEqual({ thumbnailUrl: 'thumbnails/clip-1.jpg' });
    });

    it('throws NotFoundException when no thumbnail has been extracted yet', async () => {
      prisma.clip.findUnique.mockResolvedValue({
        id: 'clip-1',
        thumbnailUrl: null,
        video: { ownerId: 'user-1' },
      });

      await expect(service.findThumbnailOrThrow('clip-1', 'user-1')).rejects.toThrow(
        NotFoundException,
      );
    });

    it('throws NotFoundException when the clip belongs to a different user', async () => {
      prisma.clip.findUnique.mockResolvedValue({
        id: 'clip-1',
        thumbnailUrl: 'thumbnails/clip-1.jpg',
        video: { ownerId: 'someone-else' },
      });

      await expect(service.findThumbnailOrThrow('clip-1', 'user-1')).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('findAnimatedThumbnailOrThrow', () => {
    it('returns the animatedThumbnailUrl when the clip belongs to the requester and has one', async () => {
      prisma.clip.findUnique.mockResolvedValue({
        id: 'clip-1',
        animatedThumbnailUrl: 'animated-thumbnails/clip-1.webp',
        video: { ownerId: 'user-1' },
      });

      const result = await service.findAnimatedThumbnailOrThrow('clip-1', 'user-1');

      expect(result).toEqual({ animatedThumbnailUrl: 'animated-thumbnails/clip-1.webp' });
    });

    it('throws NotFoundException when no animated thumbnail has been extracted yet', async () => {
      prisma.clip.findUnique.mockResolvedValue({
        id: 'clip-1',
        animatedThumbnailUrl: null,
        video: { ownerId: 'user-1' },
      });

      await expect(service.findAnimatedThumbnailOrThrow('clip-1', 'user-1')).rejects.toThrow(
        NotFoundException,
      );
    });

    it('throws NotFoundException when the clip belongs to a different user', async () => {
      prisma.clip.findUnique.mockResolvedValue({
        id: 'clip-1',
        animatedThumbnailUrl: 'animated-thumbnails/clip-1.webp',
        video: { ownerId: 'someone-else' },
      });

      await expect(service.findAnimatedThumbnailOrThrow('clip-1', 'user-1')).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('findStoryboardFrameOrThrow', () => {
    it('returns the raw key at the requested index', async () => {
      prisma.clip.findUnique.mockResolvedValue({
        id: 'clip-1',
        storyboardFrameUrls: ['storyboards/clip-1-0.webp', 'storyboards/clip-1-1.webp'],
        video: { ownerId: 'user-1' },
      });

      const result = await service.findStoryboardFrameOrThrow('clip-1', 'user-1', 1);

      expect(result).toEqual({ frameKey: 'storyboards/clip-1-1.webp' });
    });

    it('throws NotFoundException when the index is out of range', async () => {
      prisma.clip.findUnique.mockResolvedValue({
        id: 'clip-1',
        storyboardFrameUrls: ['storyboards/clip-1-0.webp'],
        video: { ownerId: 'user-1' },
      });

      await expect(service.findStoryboardFrameOrThrow('clip-1', 'user-1', 5)).rejects.toThrow(
        NotFoundException,
      );
    });

    it('throws NotFoundException when no storyboard has been extracted yet', async () => {
      prisma.clip.findUnique.mockResolvedValue({
        id: 'clip-1',
        storyboardFrameUrls: null,
        video: { ownerId: 'user-1' },
      });

      await expect(service.findStoryboardFrameOrThrow('clip-1', 'user-1', 0)).rejects.toThrow(
        NotFoundException,
      );
    });

    it('throws NotFoundException when the clip belongs to a different user', async () => {
      prisma.clip.findUnique.mockResolvedValue({
        id: 'clip-1',
        storyboardFrameUrls: ['storyboards/clip-1-0.webp'],
        video: { ownerId: 'someone-else' },
      });

      await expect(service.findStoryboardFrameOrThrow('clip-1', 'user-1', 0)).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('getExplainability', () => {
    const clip = {
      id: 'clip-1',
      video: { ownerId: 'user-1' },
      highlightScore: 74,
      highlightConfidence: 0.82,
      highlightReason: 'Strong hook and high energy throughout.',
      highlightBreakdown: [
        { signal: 'audio', feature: 'averageRmsDb', rawValue: -18, normalizedValue: 0.7, weight: 0.35, weightedContribution: 0.245 },
      ],
      highlightExplainability: {
        topFactors: [
          { signal: 'audio', feature: 'averageRmsDb', weightedContribution: 0.245, description: 'Loud, energetic audio' },
        ],
      },
      highlightPrediction: { bucket: 'likely_high_performer', rationale: 'Score of 74 with 82% confidence suggests strong potential.' },
      highlightRecommendation: { action: 'publish_as_is', message: 'This clip scores well - ready to publish as-is.' },
      highlightRank: 1,
    };

    it('returns a single v2 result mapped from the clip\'s Fusion Engine fields', async () => {
      prisma.clip.findUnique.mockResolvedValue(clip);

      const result = await service.getExplainability('clip-1', 'user-1');

      expect(result).toEqual({
        clipId: 'clip-1',
        results: [
          {
            engine: 'v2',
            highlightScore: 74,
            highlightConfidence: 0.82,
            highlightReason: 'Strong hook and high energy throughout.',
            highlightBreakdown: clip.highlightBreakdown,
            highlightExplainability: clip.highlightExplainability,
            highlightPrediction: clip.highlightPrediction,
            highlightRecommendation: clip.highlightRecommendation,
            highlightRank: 1,
          },
        ],
      });
    });

    it('defaults highlightBreakdown/highlightExplainability when null, same as toDto', async () => {
      prisma.clip.findUnique.mockResolvedValue({
        ...clip,
        highlightBreakdown: null,
        highlightExplainability: null,
        highlightPrediction: null,
        highlightRecommendation: null,
      });

      const result = await service.getExplainability('clip-1', 'user-1');

      expect(result.results[0].highlightBreakdown).toEqual([]);
      expect(result.results[0].highlightExplainability).toEqual({ topFactors: [] });
      expect(result.results[0].highlightPrediction).toBeNull();
      expect(result.results[0].highlightRecommendation).toBeNull();
    });

    it('throws NotFoundException when the clip does not exist', async () => {
      prisma.clip.findUnique.mockResolvedValue(null);

      await expect(service.getExplainability('missing', 'user-1')).rejects.toThrow(
        NotFoundException,
      );
    });

    it('throws NotFoundException when the clip belongs to a different user', async () => {
      prisma.clip.findUnique.mockResolvedValue({ ...clip, video: { ownerId: 'someone-else' } });

      await expect(service.getExplainability('clip-1', 'user-1')).rejects.toThrow(
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
      scores: null,
      reason: null,
      topics: [],
      keywords: [],
      intent: null,
      ctaText: null,
      publishRecords: [],
      updatedAt: new Date('2026-01-01'),
      video: { ownerId: 'user-1' },
    };

    it('passes thumbnailBlurDataUrl through unchanged (already client-safe, not a storage key)', async () => {
      prisma.clip.findUnique.mockResolvedValue(existingClip);
      prisma.clip.update.mockResolvedValue({
        ...existingClip,
        startTime: 12,
        endTime: 22,
        thumbnailBlurDataUrl: 'data:image/webp;base64,Zm9v',
      });

      const result = await service.update('clip-1', 'user-1', { startTime: 12, endTime: 22 });

      expect(result.thumbnailBlurDataUrl).toBe('data:image/webp;base64,Zm9v');
    });

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
        thumbnailUrl: null,
        animatedThumbnailUrl: null,
        storyboardFrameUrls: [],
        captionStyle: 'DEFAULT',
        hookText: 'Wait for it...',
        hashtags: ['viral', 'fyp'],
        scores: null,
        reason: null,
        topics: [],
        keywords: [],
        intent: null,
        ctaText: null,
        facialEmotions: null,
        sceneCutEvents: null,
        motionEnergy: [],
        motionEnergyFeatures: null,
        cameraMotion: null,
        cameraMotionFeatures: null,
        editingRhythmFeatures: null,
        audioFeatures: null,
        sceneFeatures: null,
        facialFeatures: null,
        gestures: null,
        gestureFeatures: null,
        faceLandmarks: null,
        faceLandmarkFeatures: null,
        trackingQualityMetrics: null,
        activeSpeakerSamples: null,
        speakerFaceAssociations: null,
        lipSyncVerifications: null,
        speakerTimeline: null,
        speakerTimelineFeatures: null,
        speakerConfidenceScores: null,
        speakerEngagementScores: null,
        speakerImportanceScores: null,
        speakerHighlightMoments: null,
        ocrText: null,
        ocrTracks: null,
        ocrFeatures: null,
        objects: null,
        objectTracks: null,
        objectFeatures: null,
        highlightBreakdown: [],
        highlightExplainability: { topFactors: [] },
        llmFeatures: null,
        highlightPrediction: null,
        highlightRecommendation: null,
        compositionFeatures: null,
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
      scores: null,
      reason: null,
      topics: [],
      keywords: [],
      intent: null,
      ctaText: null,
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
        keywords: [],
        scores: null,
      });
      expect(result).toEqual({
        id: 'clip-1',
        videoId: 'video-1',
        startTime: 10,
        endTime: 20,
        viralityScore: 80,
        downloadUrl: null,
        thumbnailUrl: null,
        animatedThumbnailUrl: null,
        storyboardFrameUrls: [],
        captionStyle: CaptionStyle.KARAOKE,
        hookText: 'Wait for it...',
        hashtags: ['viral', 'fyp'],
        scores: null,
        reason: null,
        topics: [],
        keywords: [],
        intent: null,
        ctaText: null,
        facialEmotions: null,
        sceneCutEvents: null,
        motionEnergy: [],
        motionEnergyFeatures: null,
        cameraMotion: null,
        cameraMotionFeatures: null,
        editingRhythmFeatures: null,
        audioFeatures: null,
        sceneFeatures: null,
        facialFeatures: null,
        gestures: null,
        gestureFeatures: null,
        faceLandmarks: null,
        faceLandmarkFeatures: null,
        trackingQualityMetrics: null,
        activeSpeakerSamples: null,
        speakerFaceAssociations: null,
        lipSyncVerifications: null,
        speakerTimeline: null,
        speakerTimelineFeatures: null,
        speakerConfidenceScores: null,
        speakerEngagementScores: null,
        speakerImportanceScores: null,
        speakerHighlightMoments: null,
        ocrText: null,
        ocrTracks: null,
        ocrFeatures: null,
        objects: null,
        objectTracks: null,
        objectFeatures: null,
        highlightBreakdown: [],
        highlightExplainability: { topFactors: [] },
        llmFeatures: null,
        highlightPrediction: null,
        highlightRecommendation: null,
        compositionFeatures: null,
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
      scheduledAt: null,
      platformPostId: null,
      errorMessage: null,
      publishedAt: null,
      viewCount: null,
      likeCount: null,
      commentCount: null,
      statsUpdatedAt: null,
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
        data: {
          clipId: 'clip-1',
          socialAccountId: 'account-1',
          status: 'QUEUED',
          scheduledAt: null,
        },
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
        scheduledAt: null,
        platformPostId: null,
        errorMessage: null,
        publishedAt: null,
        viewCount: null,
        likeCount: null,
        commentCount: null,
        statsUpdatedAt: null,
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

    it('creates a SCHEDULED PublishRecord and does not enqueue when scheduledAt is a future time', async () => {
      const futureIso = new Date(Date.now() + 60 * 60 * 1000).toISOString();
      prisma.clip.findUnique.mockResolvedValue(renderedClip);
      socialAccounts.findOwnedOrThrow.mockResolvedValue(account);
      prisma.publishRecord.create.mockResolvedValue({
        ...createdRecord,
        status: 'SCHEDULED',
        scheduledAt: new Date(futureIso),
      });

      const result = await service.publish('clip-1', 'user-1', {
        socialAccountId: 'account-1',
        scheduledAt: futureIso,
      });

      expect(prisma.publishRecord.create).toHaveBeenCalledWith({
        data: {
          clipId: 'clip-1',
          socialAccountId: 'account-1',
          status: 'SCHEDULED',
          scheduledAt: new Date(futureIso),
        },
        include: { socialAccount: true },
      });
      expect(publishClipQueue.add).not.toHaveBeenCalled();
      expect(result.status).toBe('SCHEDULED');
    });

    it('throws BadRequestException when scheduledAt is not in the future', async () => {
      prisma.clip.findUnique.mockResolvedValue(renderedClip);
      socialAccounts.findOwnedOrThrow.mockResolvedValue(account);
      const pastIso = new Date(Date.now() - 60_000).toISOString();

      await expect(
        service.publish('clip-1', 'user-1', {
          socialAccountId: 'account-1',
          scheduledAt: pastIso,
        }),
      ).rejects.toThrow(BadRequestException);
      expect(prisma.publishRecord.create).not.toHaveBeenCalled();
    });
  });

  describe('cancelScheduledPublish', () => {
    const ownedClip = {
      id: 'clip-1',
      outputUrl: 'renders/clip-1.mp4',
      video: { ownerId: 'user-1' },
    };

    it('deletes the record when it is still SCHEDULED and belongs to the clip', async () => {
      prisma.clip.findUnique.mockResolvedValue(ownedClip);
      prisma.publishRecord.deleteMany.mockResolvedValue({ count: 1 });

      await service.cancelScheduledPublish('clip-1', 'record-1', 'user-1');

      expect(prisma.publishRecord.deleteMany).toHaveBeenCalledWith({
        where: { id: 'record-1', clipId: 'clip-1', status: 'SCHEDULED' },
      });
    });

    it('throws NotFoundException when no matching SCHEDULED record exists', async () => {
      prisma.clip.findUnique.mockResolvedValue(ownedClip);
      prisma.publishRecord.deleteMany.mockResolvedValue({ count: 0 });

      await expect(service.cancelScheduledPublish('clip-1', 'record-1', 'user-1')).rejects.toThrow(
        NotFoundException,
      );
    });

    it('throws NotFoundException when the clip belongs to a different user', async () => {
      prisma.clip.findUnique.mockResolvedValue({
        ...ownedClip,
        video: { ownerId: 'someone-else' },
      });

      await expect(service.cancelScheduledPublish('clip-1', 'record-1', 'user-1')).rejects.toThrow(
        NotFoundException,
      );
      expect(prisma.publishRecord.deleteMany).not.toHaveBeenCalled();
    });
  });

  describe('reschedulePublish', () => {
    const ownedClip = {
      id: 'clip-1',
      outputUrl: 'renders/clip-1.mp4',
      video: { ownerId: 'user-1' },
    };
    const rescheduled = {
      id: 'record-1',
      clipId: 'clip-1',
      socialAccountId: 'account-1',
      status: 'SCHEDULED',
      scheduledAt: null as Date | null,
      platformPostId: null,
      errorMessage: null,
      publishedAt: null,
      createdAt: new Date('2026-01-01'),
      socialAccount: { platform: 'YOUTUBE' },
    };

    it('updates scheduledAt when the record is still SCHEDULED and belongs to the clip', async () => {
      const futureIso = new Date(Date.now() + 60 * 60 * 1000).toISOString();
      prisma.clip.findUnique.mockResolvedValue(ownedClip);
      prisma.publishRecord.updateMany.mockResolvedValue({ count: 1 });
      prisma.publishRecord.findUniqueOrThrow.mockResolvedValue({
        ...rescheduled,
        scheduledAt: new Date(futureIso),
      });

      const result = await service.reschedulePublish('clip-1', 'record-1', 'user-1', futureIso);

      expect(prisma.publishRecord.updateMany).toHaveBeenCalledWith({
        where: { id: 'record-1', clipId: 'clip-1', status: 'SCHEDULED' },
        data: { scheduledAt: new Date(futureIso) },
      });
      expect(result.scheduledAt).toBe(new Date(futureIso).toISOString());
    });

    it('throws BadRequestException when the new scheduledAt is not in the future', async () => {
      prisma.clip.findUnique.mockResolvedValue(ownedClip);
      const pastIso = new Date(Date.now() - 60_000).toISOString();

      await expect(
        service.reschedulePublish('clip-1', 'record-1', 'user-1', pastIso),
      ).rejects.toThrow(BadRequestException);
      expect(prisma.publishRecord.updateMany).not.toHaveBeenCalled();
    });

    it('throws NotFoundException when no matching SCHEDULED record exists', async () => {
      const futureIso = new Date(Date.now() + 60 * 60 * 1000).toISOString();
      prisma.clip.findUnique.mockResolvedValue(ownedClip);
      prisma.publishRecord.updateMany.mockResolvedValue({ count: 0 });

      await expect(
        service.reschedulePublish('clip-1', 'record-1', 'user-1', futureIso),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('remove', () => {
    it('deletes the clip row and cleans up its rendered output object', async () => {
      prisma.clip.findUnique.mockResolvedValue({
        id: 'clip-1',
        outputUrl: 'renders/clip-1.mp4',
        video: { ownerId: 'user-1' },
      });

      await service.remove('clip-1', 'user-1');

      expect(prisma.clip.delete).toHaveBeenCalledWith({ where: { id: 'clip-1' } });
      expect(storage.deleteObjects).toHaveBeenCalledWith(['renders/clip-1.mp4']);
    });

    it('skips storage cleanup for a clip that never finished rendering', async () => {
      prisma.clip.findUnique.mockResolvedValue({
        id: 'clip-1',
        outputUrl: null,
        video: { ownerId: 'user-1' },
      });

      await service.remove('clip-1', 'user-1');

      expect(prisma.clip.delete).toHaveBeenCalledWith({ where: { id: 'clip-1' } });
      expect(storage.deleteObjects).not.toHaveBeenCalled();
    });

    it('throws NotFoundException and deletes nothing for a missing clip', async () => {
      prisma.clip.findUnique.mockResolvedValue(null);

      await expect(service.remove('missing', 'user-1')).rejects.toThrow(NotFoundException);
      expect(prisma.clip.delete).not.toHaveBeenCalled();
      expect(storage.deleteObjects).not.toHaveBeenCalled();
    });

    it("throws NotFoundException for another user's clip (no delete, no enumeration)", async () => {
      prisma.clip.findUnique.mockResolvedValue({
        id: 'clip-1',
        outputUrl: 'renders/clip-1.mp4',
        video: { ownerId: 'someone-else' },
      });

      await expect(service.remove('clip-1', 'user-1')).rejects.toThrow(NotFoundException);
      expect(prisma.clip.delete).not.toHaveBeenCalled();
      expect(storage.deleteObjects).not.toHaveBeenCalled();
    });
  });
});
