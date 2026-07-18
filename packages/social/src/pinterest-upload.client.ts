import type { Readable } from 'node:stream';
import { PINTEREST_API_BASE_URL } from './pinterest-graph';

const POLL_INTERVAL_MS = 5_000;
const POLL_TIMEOUT_MS = 5 * 60 * 1000;

export interface PinterestUploadParams {
  accessToken: string;
  boardId: string; // see pinterest-oauth.client.ts's PinterestAccount comment
  videoStream: Readable;
  title: string;
  description: string;
  // Pinterest requires a cover image for every video Pin (a 400 otherwise) -
  // a public HTTPS URL, same presigned-URL pattern as Instagram/Facebook/
  // Threads' video handoff (packages/storage's getPresignedDownloadUrl()).
  coverImageUrl: string;
}

export interface PinterestUploadResult {
  pinId: string;
}

async function streamToBuffer(stream: Readable): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of stream) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}

interface PinterestErrorBody {
  message?: string;
}

// Pinterest's own 3-step "register media, upload bytes to the returned
// presigned S3 POST, then create the Pin" flow - see CLAUDE.md's Publish
// Center section. Buffering the whole clip up front (same "clips are
// capped at ~60s" reasoning as uploadTikTokVideo()/uploadLinkedInVideo())
// keeps this consistent with the rest of this package rather than piping.
export async function uploadPinterestVideo(
  params: PinterestUploadParams,
): Promise<PinterestUploadResult> {
  const { accessToken, boardId, videoStream, title, description, coverImageUrl } = params;
  const video = await streamToBuffer(videoStream);

  const registerRes = await fetch(`${PINTEREST_API_BASE_URL}/media`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ media_type: 'video' }),
  });
  const registerBody = (await registerRes.json()) as {
    media_id?: string;
    upload_url?: string;
    upload_parameters?: Record<string, string>;
  } & PinterestErrorBody;
  if (!registerRes.ok || !registerBody.media_id || !registerBody.upload_url) {
    throw new Error(
      `Pinterest media register failed: ${registerRes.status} ${registerBody.message ?? ''}`.trim(),
    );
  }
  const mediaId = registerBody.media_id;

  // A presigned S3 POST - upload_parameters are form fields, no Bearer auth
  // needed (this URL is pre-authorized), the video bytes go in as the
  // conventional trailing "file" field.
  const form = new FormData();
  for (const [key, value] of Object.entries(registerBody.upload_parameters ?? {})) {
    form.append(key, value);
  }
  form.append('file', new Blob([video]), 'clip.mp4');
  const uploadRes = await fetch(registerBody.upload_url, { method: 'POST', body: form });
  if (!uploadRes.ok) {
    throw new Error(`Pinterest media upload failed: ${uploadRes.status} ${await uploadRes.text()}`);
  }

  const status = await pollMediaStatus(mediaId, accessToken);
  if (status !== 'succeeded') {
    throw new Error(`Pinterest media did not finish processing (status: ${status})`);
  }

  const pinRes = await fetch(`${PINTEREST_API_BASE_URL}/pins`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      title,
      description,
      board_id: boardId,
      media_source: { source_type: 'video_id', cover_image_url: coverImageUrl, media_id: mediaId },
    }),
  });
  const pinBody = (await pinRes.json()) as { id?: string } & PinterestErrorBody;
  if (!pinRes.ok || !pinBody.id) {
    throw new Error(`Pinterest pins create failed: ${pinRes.status} ${pinBody.message ?? ''}`.trim());
  }

  return { pinId: pinBody.id };
}

// Terminal states: 'succeeded' (ready to Pin), 'failed' (never will be) -
// anything else ('registered', 'processing') keeps polling until
// POLL_TIMEOUT_MS is exhausted, same shape as Instagram/Threads' container
// status polling.
async function pollMediaStatus(mediaId: string, accessToken: string): Promise<string> {
  const deadline = Date.now() + POLL_TIMEOUT_MS;
  while (Date.now() < deadline) {
    const res = await fetch(`${PINTEREST_API_BASE_URL}/media/${mediaId}`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    const body = (await res.json()) as { status?: string } & PinterestErrorBody;
    if (!res.ok) {
      throw new Error(
        `Pinterest media status check failed: ${res.status} ${body.message ?? ''}`.trim(),
      );
    }
    if (body.status === 'succeeded' || body.status === 'failed') {
      return body.status;
    }
    await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
  }
  throw new Error('Pinterest media timed out waiting to finish processing');
}
