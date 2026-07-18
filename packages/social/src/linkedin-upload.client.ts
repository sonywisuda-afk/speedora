import type { Readable } from 'node:stream';
import { LINKEDIN_REST_BASE_URL, linkedinRestHeaders } from './linkedin-graph';

export interface LinkedInUploadParams {
  accessToken: string;
  personUrn: string; // urn:li:person:{id}, see linkedin-oauth.client.ts
  videoStream: Readable;
  title: string;
  commentary: string;
}

export interface LinkedInUploadResult {
  postUrn: string;
}

async function streamToBuffer(stream: Readable): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of stream) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}

interface InitializeUploadResponse {
  value?: {
    video?: string;
    uploadInstructions?: Array<{ uploadUrl: string; firstByte: number; lastByte: number }>;
  };
  message?: string;
}

interface LinkedInErrorBody {
  message?: string;
}

// LinkedIn's Videos API - genuinely different from every other platform in
// this package: Meta's APIs (Instagram/Facebook/Threads) and TikTok's Draft
// upload all either fetch from a URL or accept a single PUT, but LinkedIn
// computes its own fixed 4MiB part boundaries server-side and requires each
// part PUT separately with its ETag collected for the finalize call - see
// CLAUDE.md's Publish Center section. Buffering the whole clip up front
// (same "clips are capped at ~60s by detect-clips' own prompt" reasoning as
// uploadTikTokVideo()) is required either way, since initializeUpload must
// declare the exact fileSizeBytes before any bytes are sent, and each part
// needs random access into a fixed byte range.
export async function uploadLinkedInVideo(
  params: LinkedInUploadParams,
): Promise<LinkedInUploadResult> {
  const { accessToken, personUrn, videoStream, title, commentary } = params;
  const video = await streamToBuffer(videoStream);

  const initRes = await fetch(`${LINKEDIN_REST_BASE_URL}/videos?action=initializeUpload`, {
    method: 'POST',
    headers: { ...linkedinRestHeaders(accessToken), 'Content-Type': 'application/json' },
    body: JSON.stringify({
      initializeUploadRequest: {
        owner: personUrn,
        fileSizeBytes: video.length,
        uploadCaptions: false,
        uploadThumbnail: false,
      },
    }),
  });
  const initBody = (await initRes.json()) as InitializeUploadResponse;
  const videoUrn = initBody.value?.video;
  const uploadInstructions = initBody.value?.uploadInstructions;
  if (!initRes.ok || !videoUrn || !uploadInstructions?.length) {
    throw new Error(
      `LinkedIn videos initializeUpload failed: ${initRes.status} ${initBody.message ?? ''}`.trim(),
    );
  }

  // Parts must stay in uploadInstructions order - finalizeUpload's
  // uploadedPartIds array is matched positionally, not by byte range.
  const uploadedPartIds: string[] = [];
  for (const part of uploadInstructions) {
    const partRes = await fetch(part.uploadUrl, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/octet-stream' },
      body: video.subarray(part.firstByte, part.lastByte + 1),
    });
    const etag = partRes.headers.get('etag') ?? partRes.headers.get('ETag');
    if (!partRes.ok || !etag) {
      throw new Error(`LinkedIn video part upload failed: ${partRes.status} ${await partRes.text()}`);
    }
    uploadedPartIds.push(etag);
  }

  const finalizeRes = await fetch(`${LINKEDIN_REST_BASE_URL}/videos?action=finalizeUpload`, {
    method: 'POST',
    headers: { ...linkedinRestHeaders(accessToken), 'Content-Type': 'application/json' },
    body: JSON.stringify({
      finalizeUploadRequest: { video: videoUrn, uploadToken: '', uploadedPartIds },
    }),
  });
  if (!finalizeRes.ok) {
    const finalizeBody = (await finalizeRes.json().catch(() => ({}))) as LinkedInErrorBody;
    throw new Error(
      `LinkedIn videos finalizeUpload failed: ${finalizeRes.status} ${finalizeBody.message ?? ''}`.trim(),
    );
  }

  const postRes = await fetch(`${LINKEDIN_REST_BASE_URL}/posts`, {
    method: 'POST',
    headers: { ...linkedinRestHeaders(accessToken), 'Content-Type': 'application/json' },
    body: JSON.stringify({
      author: personUrn,
      commentary,
      visibility: 'PUBLIC',
      distribution: { feedDistribution: 'MAIN_FEED', targetEntities: [], thirdPartyDistributionChannels: [] },
      content: { media: { title, id: videoUrn } },
      lifecycleState: 'PUBLISHED',
      isReshareDisabledByAuthor: false,
    }),
  });
  const postUrn = postRes.headers.get('x-restli-id') ?? postRes.headers.get('X-RestLi-Id');
  if (!postRes.ok || !postUrn) {
    const postBody = (await postRes.json().catch(() => ({}))) as LinkedInErrorBody;
    throw new Error(`LinkedIn posts create failed: ${postRes.status} ${postBody.message ?? ''}`.trim());
  }

  return { postUrn };
}
