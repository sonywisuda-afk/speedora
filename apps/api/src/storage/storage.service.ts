import { Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import * as path from 'node:path';

export interface StoredFile {
  // Relative path stored as Video.sourceUrl. Swap this service's
  // implementation for a cloud-backed one to move off local disk.
  sourceUrl: string;
}

@Injectable()
export class StorageService {
  private readonly uploadDir = path.resolve(process.cwd(), process.env.UPLOAD_DIR ?? 'uploads');

  async saveVideo(file: Express.Multer.File): Promise<StoredFile> {
    await mkdir(this.uploadDir, { recursive: true });

    const ext = path.extname(file.originalname).toLowerCase();
    const filename = `${randomUUID()}${ext}`;
    await writeFile(path.join(this.uploadDir, filename), file.buffer);

    return { sourceUrl: `uploads/${filename}` };
  }
}
