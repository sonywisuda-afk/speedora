import { uploadObject } from '@viral-clip-app/storage';
import { StorageService } from './storage.service';

jest.mock('@viral-clip-app/storage', () => ({
  uploadObject: jest.fn(),
}));

describe('StorageService', () => {
  let service: StorageService;

  beforeEach(() => {
    service = new StorageService();
    jest.clearAllMocks();
  });

  it('uploads the multer buffer under a videos/<uuid><ext> key and returns it as sourceUrl', async () => {
    const file = {
      originalname: 'my clip.MP4',
      buffer: Buffer.from('video-bytes'),
      mimetype: 'video/mp4',
    } as Express.Multer.File;

    const result = await service.saveVideo(file);

    expect(uploadObject).toHaveBeenCalledTimes(1);
    const [key, body, contentType] = (uploadObject as jest.Mock).mock.calls[0];
    expect(key).toMatch(/^videos\/[0-9a-f-]{36}\.mp4$/);
    expect(body).toBe(file.buffer);
    expect(contentType).toBe('video/mp4');
    expect(result).toEqual({ sourceUrl: key });
  });

  it('lowercases the file extension', async () => {
    const file = {
      originalname: 'clip.MOV',
      buffer: Buffer.from('x'),
      mimetype: 'video/quicktime',
    } as Express.Multer.File;

    const result = await service.saveVideo(file);

    expect(result.sourceUrl.endsWith('.mov')).toBe(true);
  });
});
