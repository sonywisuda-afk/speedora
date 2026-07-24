// Only ever imported dynamically, after index.ts's dotenv config() call has
// already run - see index.ts's own comment for why this split exists
// (esbuild/tsx hoists these ES `import`s ahead of a same-file config() call -
// this is what originally broke apps/worker/src/redis.ts's
// `process.env.REDIS_URL` read, found the hard way: it silently connected to
// an unrelated `umroh-redis` container on the default port 6379 instead of
// this repo's own dev redis on 6380. redis.ts itself is fixed now - reads
// REDIS_URL lazily - but the split still protects other transitively-
// imported modules with the same eager-module-scope-env-read shape).
import { PublishStatus, SocialPlatform } from '@speedora/database';
import { prisma } from '../../prisma';
import { ApiClient } from './api-client';
import { runSyncFollowerCountOnce, runSyncPublishStatsOnce } from './direct-sync';
import { fakeTikTokDisconnected, fakeYouTubeFollowerCount, fakeYouTubeVariedSuccess, restorePlatformRegistry } from './platform-fakes';
import { Report } from './report';
import * as Scenarios from './scenarios';
import {
  deleteUserCascade,
  findPersonalWorkspaceId,
  seedFailedAtDetectClipsVideo,
  seedSocialAccounts,
  seedVideoWithClips,
} from './seed';

// Cross-Feature E2E Verification (Stabilization Pass, Area 3) - see
// C:\Users\ThinkPad\.claude\plans\abstract-imagining-quiche.md for the full
// rationale. Drives Upload -> Processing -> Publish -> Snapshot -> Overview
// -> Trend -> Campaign -> Followers -> Heatmap -> Insight -> Prediction ->
// Tracked Link -> Conversion as one real chain against the already-running
// dev Postgres/Redis, plus the 6 explicitly-requested failure scenarios.
//
// Known, deliberate scope cuts (same "frozen AI pipeline" honesty this
// codebase already applies elsewhere - see CLAUDE.md's Product Experience
// mandate): no real ffmpeg/ASR render (clips are seeded directly at
// RENDERED), no real OAuth (SocialAccounts are seeded directly with fake
// encrypted tokens), no real platform publish (a PublishRecord is flipped
// straight to PUBLISHED via Prisma right after the real HTTP
// POST /clips/:id/publish call, since actually reaching PUBLISHED requires
// a genuine platform upload this environment has no credentials for), and
// Snapshot/Followers are exercised via direct-sync.ts's exact-logic replay
// rather than the live BullMQ queue (this dev environment already has a
// separate real `apps/worker dev` process consuming those same queues -
// see direct-sync.ts's own comment for why racing it would silently defeat
// platform-fakes.ts's substitutions).

const MAIN_CLIP_COUNT = 25;
const LOW_SAMPLE_CLIP_COUNT = 2;

async function main(): Promise<void> {
  console.log(`[e2e] starting - DATABASE_URL=${process.env.DATABASE_URL} REDIS_URL=${process.env.REDIS_URL} API_PORT=${process.env.API_PORT}`);
  const report = new Report();

  console.log('[e2e] checking apps/api reachability...');
  const reachable = await ApiClient.isReachable();
  console.log(`[e2e] apps/api reachable=${reachable}`);
  if (!reachable) {
    console.error(
      `apps/api is not reachable at http://localhost:${process.env.API_PORT ?? 3001} - start it first (pnpm --filter @speedora/api start:dev) and re-run.`,
    );
    process.exitCode = 1;
    return;
  }

  const stamp = Date.now();
  const mainEmail = `e2e-cross-feature-main-${stamp}@example.com`;
  const lowEmail = `e2e-cross-feature-low-${stamp}@example.com`;
  const password = 'E2eCrossFeature!23';

  const mainApi = new ApiClient();
  const lowApi = new ApiClient();
  let mainUserId = '';
  let lowUserId = '';

  try {
    // --- Phase 0: register (real HTTP) - auto-creates each user's personal Workspace ---
    console.log('[e2e] registering main owner...');
    const mainUser = await mainApi.register(mainEmail, password);
    console.log(`[e2e] main owner registered: ${mainUser.id}`);
    mainUserId = mainUser.id;
    const mainWorkspaceId = await findPersonalWorkspaceId(mainUserId);
    console.log(`[e2e] main owner workspace: ${mainWorkspaceId}`);
    report.check('Register main owner + auto-created personal workspace', Boolean(mainWorkspaceId));

    console.log('[e2e] registering low-sample owner...');
    const lowUser = await lowApi.register(lowEmail, password);
    lowUserId = lowUser.id;
    const lowWorkspaceId = await findPersonalWorkspaceId(lowUserId);
    console.log(`[e2e] low-sample owner workspace: ${lowWorkspaceId}`);
    report.check('Register low-sample owner + auto-created personal workspace', Boolean(lowWorkspaceId));

    // --- Phase 1: Upload -> Processing (real status-event state machine) ---
    console.log(`[e2e] seeding main video + ${MAIN_CLIP_COUNT} clips...`);
    const mainClips = await seedVideoWithClips(mainUserId, mainWorkspaceId, MAIN_CLIP_COUNT);
    console.log(`[e2e] main clips seeded: ${mainClips.length}`);
    report.check(
      'Upload -> Processing: main video walked IMPORTING->UPLOADED->TRANSCRIBED->CLIPS_DETECTED->RENDERED',
      mainClips.length === MAIN_CLIP_COUNT,
    );

    const lowClips = await seedVideoWithClips(lowUserId, lowWorkspaceId, LOW_SAMPLE_CLIP_COUNT);
    report.check('Upload -> Processing: low-sample owner video seeded', lowClips.length === LOW_SAMPLE_CLIP_COUNT);

    const retryVideoId = await seedFailedAtDetectClipsVideo(mainUserId, mainWorkspaceId);

    // --- Social accounts (direct Prisma - real OAuth out of scope) ---
    const mainAccounts = await seedSocialAccounts(mainUserId);
    const lowAccounts = await seedSocialAccounts(lowUserId);

    // --- Campaigns (real HTTP) ---
    const now = new Date();
    const campaignStart = new Date(now.getTime() - 20 * 24 * 60 * 60 * 1000).toISOString();
    const campaignEnd = new Date(now.getTime() + 20 * 24 * 60 * 60 * 1000).toISOString();
    const fundedCampaign = await mainApi.createCampaign(mainWorkspaceId, {
      name: 'E2E funded campaign',
      startDate: campaignStart,
      endDate: campaignEnd,
    });
    const emptyCampaign = await mainApi.createCampaign(mainWorkspaceId, {
      name: 'E2E empty campaign (no publishes)',
      startDate: campaignStart,
      endDate: campaignEnd,
    });
    report.check('Campaign: created a funded and an empty campaign', Boolean(fundedCampaign.id) && Boolean(emptyCampaign.id));

    // --- Phase 2: Publish (real HTTP) ---
    // clips[0..19] -> YouTube (happy path); clips[20..24] -> TikTok
    // (account-not-reconnected scenario). The seeded Threads account is
    // deliberately never published to - real platform-registry.ts gives
    // every platform a syncStats, but Threads/LinkedIn are the two with NO
    // fetchFollowerCount at all, so Threads proves the real "platform
    // doesn't support this metric" gating during the Followers phase below
    // with zero substitution needed, instead of needing a real (and here,
    // unavailable) Threads API call. Half of the YouTube clips get
    // campaignId=funded, the rest none - covers both publish-with-campaign
    // and publish-without-campaign in one pass.
    interface PublishedRecord {
      clipId: string;
      recordId: string;
      platform: SocialPlatform;
      highlightScore: number;
    }
    const publishRecords: PublishedRecord[] = [];

    for (let i = 0; i < mainClips.length; i++) {
      const clip = mainClips[i];
      const isTikTok = i >= 22; // 22 YouTube (21 "other" pairs once the target clip excludes itself - clears Prediction's >=20 threshold), 3 TikTok
      const socialAccountId = isTikTok ? mainAccounts.tiktokId : mainAccounts.youtubeId;
      const platform = isTikTok ? SocialPlatform.TIKTOK : SocialPlatform.YOUTUBE;
      const campaignId = i < 8 ? fundedCampaign.id : undefined;
      const record = await mainApi.publishClip(clip.id, { socialAccountId, campaignId });
      publishRecords.push({ clipId: clip.id, recordId: record.id, platform, highlightScore: clip.highlightScore });
    }
    report.check(
      'Publish: created PublishRecords across YouTube/TikTok, with and without campaignId',
      publishRecords.length === mainClips.length,
    );

    const lowRecord = await lowApi.publishClip(lowClips[0].id, { socialAccountId: lowAccounts.youtubeId });

    // Flip every created PublishRecord to PUBLISHED - real platform upload
    // is out of scope (see module doc comment above) - spread publishedAt
    // over the last 14 days for trend/heatmap variety, with a
    // platformPostId this run controls so the substituted syncStats can
    // look values up deterministically (and refuse to touch anything else).
    const publishedAtFor = (i: number) =>
      new Date(now.getTime() - (i % 14) * 24 * 60 * 60 * 1000 - (i % 24) * 60 * 60 * 1000);
    for (let i = 0; i < publishRecords.length; i++) {
      const pr = publishRecords[i];
      await prisma.publishRecord.update({
        where: { id: pr.recordId },
        data: { status: PublishStatus.PUBLISHED, publishedAt: publishedAtFor(i), platformPostId: `e2e-${pr.recordId}` },
      });
    }
    await prisma.publishRecord.update({
      where: { id: lowRecord.id },
      data: { status: PublishStatus.PUBLISHED, publishedAt: now, platformPostId: `e2e-${lowRecord.id}` },
    });

    // --- Phase 3/4: Snapshot + Followers (real worker code, substituted platformRegistry) ---
    const statsByPostId = new Map<string, { viewCount: number; likeCount: number; commentCount: number }>();
    for (const pr of publishRecords.filter((p) => p.platform === SocialPlatform.YOUTUBE)) {
      const viewCount = Math.round(300 + pr.highlightScore * 9700);
      statsByPostId.set(`e2e-${pr.recordId}`, {
        viewCount,
        likeCount: Math.round(viewCount * 0.05),
        commentCount: Math.round(viewCount * 0.01),
      });
    }
    statsByPostId.set(`e2e-${lowRecord.id}`, { viewCount: 5000, likeCount: 200, commentCount: 40 });

    fakeYouTubeVariedSuccess(statsByPostId);
    fakeTikTokDisconnected();
    fakeYouTubeFollowerCount(mainAccounts.youtubePlatformAccountId, 12_345);

    const statsResult = await runSyncPublishStatsOnce();
    console.log(`[e2e] sync-publish-stats: synced=${statsResult.synced} pending=${statsResult.pending}`);
    const followerResult = await runSyncFollowerCountOnce();
    console.log(`[e2e] sync-follower-count: synced=${followerResult.synced}`);

    restorePlatformRegistry();

    const youtubeSample = publishRecords.find((p) => p.platform === SocialPlatform.YOUTUBE)!;
    const tiktokSample = publishRecords.find((p) => p.platform === SocialPlatform.TIKTOK)!;
    const [youtubeRow, tiktokRow] = await Promise.all([
      prisma.publishRecord.findUniqueOrThrow({ where: { id: youtubeSample.recordId } }),
      prisma.publishRecord.findUniqueOrThrow({ where: { id: tiktokSample.recordId } }),
    ]);
    report.check(
      'Snapshot: YouTube record got a real snapshot (viewCount + statsUpdatedAt)',
      youtubeRow.statsUpdatedAt !== null && youtubeRow.viewCount !== null,
    );

    const disconnected = Scenarios.checkDisconnectedAccountIsolated(tiktokRow.statsUpdatedAt, youtubeRow.statsUpdatedAt);
    report.check('Failure scenario: TikTok account not reconnected (isolated per-record failure)', disconnected.pass, disconnected.detail);

    const [youtubeAccountRow, threadsAccountRow] = await Promise.all([
      prisma.socialAccount.findUnique({ where: { id: mainAccounts.youtubeId }, include: { followerSnapshots: true } }),
      prisma.socialAccount.findUnique({ where: { id: mainAccounts.threadsId }, include: { followerSnapshots: true } }),
    ]);
    report.check('Followers: real SocialAccountFollowerSnapshot written for YouTube', (youtubeAccountRow?.followerSnapshots.length ?? 0) > 0);

    const unsupported = Scenarios.checkUnsupportedPlatformSkipped(
      threadsAccountRow && threadsAccountRow.followerSnapshots.length > 0 ? new Date() : null,
      youtubeAccountRow && youtubeAccountRow.followerSnapshots.length > 0 ? new Date() : null,
    );
    report.check(
      "Failure scenario: platform doesn't support this metric (Threads has no fetchFollowerCount at all, real gating)",
      unsupported.pass,
      unsupported.detail,
    );

    // --- Phase 5: Overview / Trend / Followers / Heatmap (real HTTP) ---
    const overview = await mainApi.getAnalyticsOverview();
    report.check('Overview: GET /analytics/overview reachable', typeof overview === 'object' && overview !== null);
    const performance = await mainApi.getAnalyticsPerformance();
    report.check('Trend: GET /analytics/performance reachable', typeof performance === 'object' && performance !== null);
    const followers = await mainApi.getAnalyticsFollowers();
    report.check('Followers dashboard: GET /analytics/followers reachable', typeof followers === 'object' && followers !== null);
    const heatmap = await mainApi.getAnalyticsHeatmap();
    report.check('Heatmap: GET /analytics/heatmap reachable', typeof heatmap === 'object' && heatmap !== null);

    // --- Phase 6: Campaign, incl. campaign-without-publish (real HTTP) ---
    const fundedAnalytics = await mainApi.getCampaignAnalytics(fundedCampaign.id);
    report.check('Campaign analytics: funded campaign returns real totals', fundedAnalytics.totals !== undefined);
    const emptyAnalytics = await mainApi.getCampaignAnalytics(emptyCampaign.id);
    const emptyCheck = Scenarios.checkEmptyCampaignAnalyticsGraceful(emptyAnalytics);
    report.check('Failure scenario: campaign without publish returns a graceful empty analytics response', emptyCheck.pass, emptyCheck.detail);

    // --- Phase 7: Insight + Prediction (real HTTP) ---
    // Index 21 - the last of the 22 YouTube (real-synced-data) clips, NOT
    // the very last clip overall: indices 22-24 are TikTok, whose sync
    // always fails (see the disconnected-account scenario above), so that
    // clip has no own engagementScore and would correctly, separately
    // report not_enough_data regardless of how many OTHER clips have data -
    // picking one of those would test the wrong gate. Excluding itself,
    // this leaves 21 other YouTube (highlightScore, engagementScore) pairs -
    // clears Prediction's own >=20 threshold with margin.
    const richClipId = mainClips[21].id;
    const richPerformance = await mainApi.getClipPerformance(richClipId);
    report.check(
      'Insight: reaches a real (non-gated) classification with >=20 historical samples',
      richPerformance.insight?.classification !== 'not_enough_data',
      `classification=${richPerformance.insight?.classification}`,
    );
    report.check(
      'Prediction: reaches available=true with >=20 (highlightScore, engagementScore) pairs',
      richPerformance.insight?.prediction?.available === true,
      `available=${richPerformance.insight?.prediction?.available}`,
    );

    const lowPerformance = await lowApi.getClipPerformance(lowClips[0].id);
    report.check(
      'Insight gate: low-sample owner correctly stays at not_enough_data',
      lowPerformance.insight?.classification === 'not_enough_data',
      `classification=${lowPerformance.insight?.classification}`,
    );
    report.check(
      'Prediction gate: low-sample owner correctly stays at available=false',
      lowPerformance.insight?.prediction?.available === false,
      `available=${lowPerformance.insight?.prediction?.available}`,
    );

    const noCampaignClip = mainClips[15]; // YouTube, index >= 8 so published without campaignId
    const noCampaignPerf = await mainApi.getClipPerformance(noCampaignClip.id);
    const publishNoCampaignCheck = Scenarios.checkPublishWithoutCampaignWorks(typeof noCampaignPerf === 'object' && noCampaignPerf !== null);
    report.check('Failure scenario: publish without campaign still returns a normal clip performance response', publishNoCampaignCheck.pass, publishNoCampaignCheck.detail);

    // --- Phase 8: Tracked Link -> Conversion (real HTTP) ---
    const trackedLink = await mainApi.createTrackedLink(mainWorkspaceId, {
      destinationUrl: 'https://example.com/e2e-cross-feature',
      publishRecordId: publishRecords[0].recordId,
    });

    const before = (await prisma.trackedLink.findUniqueOrThrow({ where: { id: trackedLink.id } })).clickCount;
    const normalUa = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) E2ECrossFeatureTest';
    const click1 = await mainApi.clickRedirect(trackedLink.slug, normalUa);
    const afterFirst = (await prisma.trackedLink.findUniqueOrThrow({ where: { id: trackedLink.id } })).clickCount;
    report.check('Tracked Link: real click redirects with 302', click1.status === 302, `status=${click1.status}`);
    report.check('Conversion: real (non-bot) click is counted', afterFirst === before + 1, `before=${before} after=${afterFirst}`);

    const click2 = await mainApi.clickRedirect(trackedLink.slug, normalUa);
    const afterRepeat = (await prisma.trackedLink.findUniqueOrThrow({ where: { id: trackedLink.id } })).clickCount;
    const dedupCheck = Scenarios.checkDedupWindowCollapsedRepeatClick(afterFirst, afterRepeat);
    report.check('Conversion dedup: immediate repeat click (same ip+ua, <5s) is not double-counted', dedupCheck.pass, dedupCheck.detail);
    report.check('Tracked Link: deduped repeat click still redirects with 302', click2.status === 302, `status=${click2.status}`);

    const botUa = 'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)';
    const click3 = await mainApi.clickRedirect(trackedLink.slug, botUa);
    const afterBot = (await prisma.trackedLink.findUniqueOrThrow({ where: { id: trackedLink.id } })).clickCount;
    const botCheck = Scenarios.checkBotClickNotCounted(afterRepeat, afterBot);
    report.check('Failure scenario: bot click is not counted as a conversion', botCheck.pass, botCheck.detail);
    report.check('Bot click still redirects (real hit, just excluded from clickCount)', click3.status === 302, `status=${click3.status}`);

    const perfAfterClicks = await mainApi.getClipPerformance(mainClips[0].id);
    const trafficEntry = (perfAfterClicks.traffic as Array<{ publishRecordId: string; conversionCount: number | null }> | undefined)?.find(
      (t) => t.publishRecordId === publishRecords[0].recordId,
    );
    report.check(
      'Conversion: clip performance traffic.conversionCount reflects the real, deduped, non-bot click count',
      trafficEntry?.conversionCount === afterBot,
      `conversionCount=${trafficEntry?.conversionCount} expected=${afterBot}`,
    );

    // --- Phase 9: worker failure -> retry (real HTTP) ---
    await mainApi.retryVideo(retryVideoId);
    const retriedVideo = await prisma.video.findUniqueOrThrow({
      where: { id: retryVideoId },
      include: { clips: true, transcriptSegments: true },
    });
    const retryOutcome = Scenarios.checkRetryResumedCorrectStage({
      latestStatus: retriedVideo.status,
      hasTranscriptSegments: retriedVideo.transcriptSegments.length > 0,
      hasClips: retriedVideo.clips.length > 0,
    });
    report.check(
      'Failure scenario: worker failed -> retry resumes at the correct stage (detect-clips, not re-transcribe)',
      retryOutcome.pass,
      retryOutcome.detail,
    );
  } catch (error) {
    report.check('unexpected error during run', false, (error as Error).stack ?? String(error));
    console.error(error);
  } finally {
    restorePlatformRegistry();
    if (mainUserId) await deleteUserCascade(mainUserId);
    if (lowUserId) await deleteUserCascade(lowUserId);
    await prisma.$disconnect();
  }

  const allPassed = report.print();
  process.exitCode = allPassed ? 0 : 1;
}

export { main };
