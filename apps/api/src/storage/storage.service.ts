import { Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import * as path from 'node:path';

export interface StoredFile {
  // Absolute path stored as Video.sourceUrl, so apps/worker (a separate
  // process/cwd) can read it directly without resolving against apps/api's
  // UPLOAD_DIR. Swap this service's implementation for a cloud-backed one
  // (returning a real URL) to move off local disk.
  sourceUrl: string;
}

@Injectable()
export class StorageService {
  private readonly uploadDir = path.resolve(process.cwd(), process.env.UPLOAD_DIR ?? 'uploads');

  async saveVideo(file: Express.Multer.File): Promise<StoredFile> {
    await mkdir(this.uploadDir, { recursive: true });

    const ext = path.extname(file.originalname).toLowerCase();
    const filename = `${randomUUID()}${ext}`;
    const absolutePath = path.join(this.uploadDir, filename);
    await writeFile(absolutePath, file.buffer);

    return { sourceUrl: absolutePath };
  }
}
