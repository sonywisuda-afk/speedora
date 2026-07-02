import { Injectable } from '@nestjs/common';
import { uploadObject } from '@viral-clip-app/storage';
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
  async saveVideo(file: Express.Multer.File): Promise<StoredFile> {
    const ext = path.extname(file.originalname).toLowerCase();
    const key = `videos/${randomUUID()}${ext}`;
    await uploadObject(key, file.buffer, file.mimetype);

    return { sourceUrl: key };
  }
}
