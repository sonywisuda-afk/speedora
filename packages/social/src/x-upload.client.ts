import type { Readable } from 'node:stream';
import { X_API_BASE_URL } from './x-graph';

const MEDIA_UPLOAD_URL = `${X_API_BASE_URL}/media/upload`;
const CHUNK_SIZE_BYTES = 4 * 1024 * 1024; // under X's documented 5MB-per-APPEND cap
const POLL_INTERVAL_MS = 5_000;
const POLL_TIMEOUT_MS = 5 * 60 * 1000;
// X's tweet text hard limit - the caption is truncated to fit rather than
// rejected outright, same "clip is still published, just with a shorter
// caption" posture as this being a best-effort integration overall (see
// CLAUDE.md's Publish Center section on X).
const MAX_TWEET_TEXT_LENGTH = 280;

export interface XUploadParams {
  accessToken: string;
  videoStream: Readable;
  text: string;
}

export interface XUploadResult {
  tweetId: string;
}

async function streamToBuffer(stream: Readable): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of stream) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}

interface XErrorBody {
  title?: string;
  detail?: string;
}

function errorMessageOf(body: { errors?: XErrorBody[]; title?: string; detail?: string }): string {
  const first = body.errors?.[0];
  return first?.detail ?? first?.title ?? body.detail ?? body.title ?? '';
}

// X's chunked media upload (INIT -> APPEND* -> FINALIZE -> poll STATUS),
// then POST /2/tweets referencing the resulting media_id - see CLAUDE.md's
// Publish Center section. Buffering the whole clip up front (same "clips
// are capped at ~60s" reasoning as uploadTikTokVideo()/uploadLinkedInVideo())
// is required either way, since INIT must declare total_bytes before any
// chunk is sent.
export async function uploadXVideo(params: XUploadParams): Promise<XUploadResult> {
  const { accessToken, videoStream, text } = params;
  const video = await streamToBuffer(videoStream);
  const authHeaders = { Authorization: `Bearer ${accessToken}` };

  const initForm = new FormData();
  initForm.append('command', 'INIT');
  initForm.append('media_type', 'video/mp4');
  initForm.append('total_bytes', String(video.length));
  initForm.append('media_category', 'tweet_video');
  const initRes = await fetch(MEDIA_UPLOAD_URL, {
    method: 'POST',
    headers: authHeaders,
    body: initForm,
  });
  const initBody = (await initRes.json()) as { data?: { id?: string } } & { errors?: XErrorBody[] };
  const mediaId = initBody.data?.id;
  if (!initRes.ok || !mediaId) {
    throw new Error(
      `X media/upload INIT failed: ${initRes.status} ${errorMessageOf(initBody)}`.trim(),
    );
  }

  for (
    let offset = 0, segmentIndex = 0;
    offset < video.length;
    offset += CHUNK_SIZE_BYTES, segmentIndex++
  ) {
    const chunk = video.subarray(offset, offset + CHUNK_SIZE_BYTES);
    const appendForm = new FormData();
    appendForm.append('command', 'APPEND');
    appendForm.append('media_id', mediaId);
    appendForm.append('segment_index', String(segmentIndex));
    appendForm.append('media', new Blob([chunk]), 'clip.mp4');
    const appendRes = await fetch(MEDIA_UPLOAD_URL, {
      method: 'POST',
      headers: authHeaders,
      body: appendForm,
    });
    if (!appendRes.ok) {
      throw new Error(
        `X media/upload APPEND failed: ${appendRes.status} ${await appendRes.text()}`,
      );
    }
  }

  const finalizeForm = new FormData();
  finalizeForm.append('command', 'FINALIZE');
  finalizeForm.append('media_id', mediaId);
  const finalizeRes = await fetch(MEDIA_UPLOAD_URL, {
    method: 'POST',
    headers: authHeaders,
    body: finalizeForm,
  });
  const finalizeBody = (await finalizeRes.json()) as {
    data?: { processing_info?: { state?: string } };
  } & { errors?: XErrorBody[] };
  if (!finalizeRes.ok) {
    throw new Error(
      `X media/upload FINALIZE failed: ${finalizeRes.status} ${errorMessageOf(finalizeBody)}`.trim(),
    );
  }

  // processing_info is only present for video/GIF - absent means the
  // (rare, non-video) media was ready immediately.
  if (finalizeBody.data?.processing_info) {
    const status = await pollMediaStatus(mediaId, accessToken);
    if (status !== 'succeeded') {
      throw new Error(`X media did not finish processing (status: ${status})`);
    }
  }

  const tweetRes = await fetch(`${X_API_BASE_URL}/tweets`, {
    method: 'POST',
    headers: { ...authHeaders, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      text: text.slice(0, MAX_TWEET_TEXT_LENGTH),
      media: { media_ids: [mediaId] },
    }),
  });
  const tweetBody = (await tweetRes.json()) as { data?: { id?: string } } & {
    errors?: XErrorBody[];
  };
  if (!tweetRes.ok || !tweetBody.data?.id) {
    throw new Error(
      `X tweets create failed: ${tweetRes.status} ${errorMessageOf(tweetBody)}`.trim(),
    );
  }

  return { tweetId: tweetBody.data.id };
}

// Terminal states: 'succeeded' (ready), 'failed' (never will be) -
// 'pending'/'in_progress' keep polling until POLL_TIMEOUT_MS is exhausted,
// same shape as every other platform's container/media status polling in
// this package.
async function pollMediaStatus(mediaId: string, accessToken: string): Promise<string> {
  const deadline = Date.now() + POLL_TIMEOUT_MS;
  while (Date.now() < deadline) {
    const url = new URL(MEDIA_UPLOAD_URL);
    url.searchParams.set('command', 'STATUS');
    url.searchParams.set('media_id', mediaId);
    const res = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}` } });
    const body = (await res.json()) as { data?: { processing_info?: { state?: string } } } & {
      errors?: XErrorBody[];
    };
    if (!res.ok) {
      throw new Error(`X media/upload STATUS failed: ${res.status} ${errorMessageOf(body)}`.trim());
    }
    const state = body.data?.processing_info?.state;
    if (state === 'succeeded' || state === 'failed') {
      return state;
    }
    await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
  }
  throw new Error('X media timed out waiting to finish processing');
}
