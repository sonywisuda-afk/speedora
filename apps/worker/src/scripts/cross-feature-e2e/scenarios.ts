// Pure assertion helpers for the 6 explicitly-requested failure scenarios -
// each takes data index.ts already fetched via real HTTP/Prisma calls and
// returns a pass/fail + detail, so the actual DB/HTTP orchestration stays in
// one place (index.ts) and these stay easy to read/audit independently.

export interface RetryOutcome {
  latestStatus: string;
  hasTranscriptSegments: boolean;
  hasClips: boolean;
}

// (a) Worker gagal -> retry: a video that failed with segments-but-no-clips
// must resume at CLIPS_DETECTED (detect-clips), never re-run transcribe.
export function checkRetryResumedCorrectStage(outcome: RetryOutcome): {
  pass: boolean;
  detail: string;
} {
  const pass =
    outcome.hasTranscriptSegments && !outcome.hasClips && outcome.latestStatus === 'TRANSCRIBED';
  return {
    pass,
    detail: `status=${outcome.latestStatus} segments=${outcome.hasTranscriptSegments} clips=${outcome.hasClips}`,
  };
}

// (b) Platform tidak mendukung metrik tertentu: Threads has no syncStats at
// all in the real platformRegistry, so its PublishRecord must never get a
// snapshot/statsUpdatedAt, while YouTube (which does support it) does.
export function checkUnsupportedPlatformSkipped(
  threadsStatsUpdatedAt: Date | null,
  youtubeStatsUpdatedAt: Date | null,
): { pass: boolean; detail: string } {
  const pass = threadsStatsUpdatedAt === null && youtubeStatsUpdatedAt !== null;
  return { pass, detail: `threads=${threadsStatsUpdatedAt} youtube=${youtubeStatsUpdatedAt}` };
}

// (c) Akun TikTok belum reconnect: TikTok's syncStats throwing must not
// prevent YouTube's records in the same batch run from getting synced -
// real per-record isolation, not per-batch.
export function checkDisconnectedAccountIsolated(
  tiktokStatsUpdatedAt: Date | null,
  youtubeStatsUpdatedAt: Date | null,
): { pass: boolean; detail: string } {
  const pass = tiktokStatsUpdatedAt === null && youtubeStatsUpdatedAt !== null;
  return { pass, detail: `tiktok=${tiktokStatsUpdatedAt} youtube=${youtubeStatsUpdatedAt}` };
}

// (d) Tracked link bot click: a bot-UA click must redirect (still a real
// 302) but must NOT count toward clickCount/conversionCount.
export function checkBotClickNotCounted(
  clickCountBefore: number,
  clickCountAfterBotClick: number,
): { pass: boolean; detail: string } {
  const pass = clickCountAfterBotClick === clickCountBefore;
  return { pass, detail: `before=${clickCountBefore} afterBotClick=${clickCountAfterBotClick}` };
}

// Same dedup check, factored out since it's asserted right alongside (d).
export function checkDedupWindowCollapsedRepeatClick(
  clickCountAfterFirstClick: number,
  clickCountAfterImmediateRepeat: number,
): { pass: boolean; detail: string } {
  const pass = clickCountAfterImmediateRepeat === clickCountAfterFirstClick;
  return {
    pass,
    detail: `afterFirst=${clickCountAfterFirstClick} afterRepeat=${clickCountAfterImmediateRepeat}`,
  };
}

// (e) Publish tanpa campaign: a clip published with no campaignId must still
// produce a normal (non-error) clip performance response.
export function checkPublishWithoutCampaignWorks(performanceResponseOk: boolean): {
  pass: boolean;
  detail: string;
} {
  return { pass: performanceResponseOk, detail: `performanceResponseOk=${performanceResponseOk}` };
}

// (f) Campaign tanpa publish: a campaign with zero PublishRecords must
// return a graceful empty/zero analytics response, not throw.
export function checkEmptyCampaignAnalyticsGraceful(analytics: {
  totals: unknown;
  conversionCount: number | null;
}): { pass: boolean; detail: string } {
  const pass = analytics.totals !== undefined && analytics.totals !== null;
  return { pass, detail: `totals defined=${pass} conversionCount=${analytics.conversionCount}` };
}
