import { Injectable, Logger } from '@nestjs/common';
import { deleteObject, uploadObject } from '@speedora/storage';
import { randomUUID } from 'node:crypto';
import * as path from 'node:path';
import sharp from 'sharp';

export interface StoredFile {
  // Object storage key stored as Video.sourceUrl (not a local path or a
  // full URL) - apps/worker reads the same key directly from the same
  // bucket, so there's no cross-process filesystem concern at all here.
  sourceUrl: string;
}

@Injectable()
export class StorageService {
  private readonly logger = new Logger(StorageService.name);

  async saveVideo(file: Express.Multer.File): Promise<StoredFile> {
    const ext = path.extname(file.originalname).toLowerCase();
    const key = `videos/${randomUUID()}${ext}`;
    await uploadObject(key, file.buffer, file.mimetype);

    return { sourceUrl: key };
  }

  // Sprint 03d (Export Center roadmap, Brand Kit) - same shape as saveVideo
  // above, just a different key prefix. Returns the raw storage key, same
  // "caller decides what to do with it" contract as saveVideo.
  async saveBrandLogo(file: Express.Multer.File): Promise<string> {
    const ext = path.extname(file.originalname).toLowerCase();
    const key = `brand-logos/${randomUUID()}${ext}`;
    await uploadObject(key, file.buffer, file.mimetype);

    return key;
  }

  // Watermark roadmap (P3c) - same shape as saveBrandLogo above, but SVG
  // uploads are rasterized to PNG first (stock ffmpeg builds have no SVG
  // decoder - apps/worker's renderClip() must always be able to hand a
  // plain raster image to its overlay filter). A raster upload (PNG/JPEG/
  // WebP) passes through untouched, same as saveBrandLogo. Rasterizing
  // once here at upload time (not per-render in the worker) is a one-time
  // cost rather than a repeated one.
  async saveBrandWatermark(file: Express.Multer.File): Promise<string> {
    const isSvg = file.mimetype === 'image/svg+xml';
    const buffer = isSvg
      ? await sharp(file.buffer, { density: 300 }).png().toBuffer()
      : file.buffer;
    const ext = isSvg ? '.png' : path.extname(file.originalname).toLowerCase();
    const key = `watermarks/${randomUUID()}${ext}`;
    await uploadObject(key, buffer, isSvg ? 'image/png' : file.mimetype);

    return key;
  }

  // Sprint 5C (Comments) - same shape as saveBrandLogo above, a different
  // key prefix. Keeps the original filename in the returned key's basename
  // (URL-unsafe characters aside) so a stored object stays identifiable
  // in the bucket, but CommentAttachment.fileName (not this key) is what's
  // ever shown to a user - see CommentService.
  async saveCommentAttachment(file: Express.Multer.File): Promise<string> {
    const ext = path.extname(file.originalname).toLowerCase();
    const key = `comment-attachments/${randomUUID()}${ext}`;
    await uploadObject(key, file.buffer, file.mimetype);

    return key;
  }

  // Best-effort cleanup used when a video (or a whole account) is deleted -
  // the DB row is the source of truth and has already been removed by the
  // time this runs, so a storage object that's already gone (or a transient
  // storage error) must not turn the delete into a failure. Blank keys (a
  // source still empty because the video was mid-import) are skipped.
  async deleteObjects(keys: string[]): Promise<void> {
    await Promise.all(
      keys
        .filter((key) => key.length > 0)
        .map((key) =>
          deleteObject(key).catch((error) => {
            this.logger.warn(`Failed to delete storage object ${key}: ${error}`);
          }),
        ),
    );
  }
}
