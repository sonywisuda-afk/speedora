import {
  DeleteObjectCommand,
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import type { Readable } from 'node:stream';

let client: S3Client | null = null;

// Lazy - constructed on first use, not at module load time. Both apps/api
// (via NestJS's module graph) and apps/worker (via CommonJS require order)
// can end up importing this before their root .env file has been loaded;
// reading STORAGE_* eagerly at module scope would silently pick up
// undefined values in that case. See QueueModule/JwtStrategy in apps/api
// for the same class of bug hit earlier in this project.
function getClient(): S3Client {
  if (!client) {
    client = new S3Client({
      region: process.env.STORAGE_REGION ?? 'auto',
      endpoint: process.env.STORAGE_ENDPOINT,
      forcePathStyle: (process.env.STORAGE_FORCE_PATH_STYLE ?? 'true') === 'true',
      credentials: {
        accessKeyId: process.env.STORAGE_ACCESS_KEY_ID ?? '',
        secretAccessKey: process.env.STORAGE_SECRET_ACCESS_KEY ?? '',
      },
      // The SDK's default request timeout is 0 (disabled) - a keep-alive
      // connection from this client's pool that goes stale (observed
      // against R2: reused successfully once, then a later call on the
      // exact same client hangs forever with no error) would otherwise
      // block the caller indefinitely instead of failing. connectionTimeout
      // bounds establishing a new connection; requestTimeout bounds the
      // whole request/response, generous enough for a large legitimate
      // video upload/download over a slow link. throwOnRequestTimeout is
      // required - without it a request-timeout breach is only logged as a
      // warning, not thrown (see @smithy/types's NodeHttpHandlerOptions).
      requestHandler: {
        connectionTimeout: 10_000,
        requestTimeout: 5 * 60 * 1000,
        throwOnRequestTimeout: true,
      },
    });
  }
  return client;
}

function bucket(): string {
  const value = process.env.STORAGE_BUCKET;
  if (!value) {
    throw new Error('STORAGE_BUCKET is not set');
  }
  return value;
}

export async function uploadObject(key: string, body: Buffer, contentType?: string): Promise<void> {
  await getClient().send(
    new PutObjectCommand({ Bucket: bucket(), Key: key, Body: body, ContentType: contentType }),
  );
}

export async function getObjectStream(key: string): Promise<Readable> {
  const result = await getClient().send(new GetObjectCommand({ Bucket: bucket(), Key: key }));
  return result.Body as Readable;
}

export interface RangeObjectResult {
  stream: Readable;
  contentType?: string;
  // Total size of the requested range (or the whole object, if no Range
  // header was sent) - what the caller sets Content-Length to.
  contentLength?: number;
  // Only set when `range` was provided and the request was satisfiable -
  // the caller uses this as the HTTP Content-Range response header and to
  // decide between a 200 and a 206 status.
  contentRange?: string;
}

// Like getObjectStream, but passes through an HTTP Range header (e.g.
// "bytes=0-1023") so a <video> element can seek within a large file without
// downloading the whole thing first - see GET /videos/:id/source in
// apps/api, the only caller that needs this. Kept separate from
// getObjectStream rather than adding an optional param there, since none of
// its three existing callers (clip download, worker transcribe/render-clip
// source reads) need partial-content semantics.
export async function getObjectStreamRange(
  key: string,
  range?: string,
): Promise<RangeObjectResult> {
  const result = await getClient().send(
    new GetObjectCommand({ Bucket: bucket(), Key: key, Range: range }),
  );
  return {
    stream: result.Body as Readable,
    contentType: result.ContentType,
    contentLength: result.ContentLength,
    contentRange: result.ContentRange,
  };
}

export async function deleteObject(key: string): Promise<void> {
  await getClient().send(new DeleteObjectCommand({ Bucket: bucket(), Key: key }));
}

// The one caller (apps/worker's publish-clip job, for an Instagram Reels
// publish - see CLAUDE.md's Fase 6d "Instagram" section) needs to hand a
// clip to Meta's servers, and Instagram's Content Publishing API can only
// ingest video via a public HTTPS URL it fetches itself - unlike YouTube/
// TikTok, there's no direct byte-upload option. This is the first time this
// project exposes anything resembling a direct link to the bucket (every
// other read path goes through an authenticated apps/api endpoint) - kept
// short-lived and scoped to exactly one object/one call, generated
// server-side and never returned to a browser client.
export async function getPresignedDownloadUrl(
  key: string,
  expiresInSeconds: number,
): Promise<string> {
  const command = new GetObjectCommand({ Bucket: bucket(), Key: key });
  return getSignedUrl(getClient(), command, { expiresIn: expiresInSeconds });
}
