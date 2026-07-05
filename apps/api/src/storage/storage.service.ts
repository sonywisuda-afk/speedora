import { Injectable, Logger } from '@nestjs/common';
import { deleteObject, uploadObject } from '@speedora/storage';
import { randomUUID } from 'node:crypto';
import * as path from 'node:path';

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
