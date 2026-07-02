import {
  DeleteObjectCommand,
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
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

export async function deleteObject(key: string): Promise<void> {
  await getClient().send(new DeleteObjectCommand({ Bucket: bucket(), Key: key }));
}
