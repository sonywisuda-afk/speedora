const sendMock = jest.fn();

jest.mock('@aws-sdk/client-s3', () => {
  class FakeCommand {
    constructor(public readonly input: unknown) {}
  }
  return {
    S3Client: jest.fn().mockImplementation(() => ({ send: sendMock })),
    PutObjectCommand: class extends FakeCommand {},
    GetObjectCommand: class extends FakeCommand {},
    DeleteObjectCommand: class extends FakeCommand {},
  };
});

const ENV_KEYS = [
  'STORAGE_REGION',
  'STORAGE_ENDPOINT',
  'STORAGE_FORCE_PATH_STYLE',
  'STORAGE_ACCESS_KEY_ID',
  'STORAGE_SECRET_ACCESS_KEY',
  'STORAGE_BUCKET',
] as const;

describe('packages/storage', () => {
  const originalEnv: Record<string, string | undefined> = {};

  beforeAll(() => {
    for (const key of ENV_KEYS) originalEnv[key] = process.env[key];
  });

  afterAll(() => {
    for (const key of ENV_KEYS) {
      if (originalEnv[key] === undefined) delete process.env[key];
      else process.env[key] = originalEnv[key];
    }
  });

  beforeEach(() => {
    jest.resetModules();
    sendMock.mockReset();
    for (const key of ENV_KEYS) delete process.env[key];
    process.env.STORAGE_BUCKET = 'test-bucket';
    process.env.STORAGE_ACCESS_KEY_ID = 'test-key-id';
    process.env.STORAGE_SECRET_ACCESS_KEY = 'test-secret';
  });

  it('uploadObject sends a PutObjectCommand with the bucket, key, body, and content type', async () => {
    sendMock.mockResolvedValue({});
    const { uploadObject } = await import('./index');

    const body = Buffer.from('hello world');
    await uploadObject('videos/abc.mp4', body, 'video/mp4');

    expect(sendMock).toHaveBeenCalledTimes(1);
    const command = sendMock.mock.calls[0][0];
    expect(command.input).toEqual({
      Bucket: 'test-bucket',
      Key: 'videos/abc.mp4',
      Body: body,
      ContentType: 'video/mp4',
    });
  });

  it('getObjectStream sends a GetObjectCommand and returns the response Body', async () => {
    const fakeStream = { fake: 'stream' };
    sendMock.mockResolvedValue({ Body: fakeStream });
    const { getObjectStream } = await import('./index');

    const result = await getObjectStream('renders/clip.mp4');

    expect(result).toBe(fakeStream);
    const command = sendMock.mock.calls[0][0];
    expect(command.input).toEqual({ Bucket: 'test-bucket', Key: 'renders/clip.mp4' });
  });

  it('deleteObject sends a DeleteObjectCommand for the given key', async () => {
    sendMock.mockResolvedValue({});
    const { deleteObject } = await import('./index');

    await deleteObject('videos/abc.mp4');

    const command = sendMock.mock.calls[0][0];
    expect(command.input).toEqual({ Bucket: 'test-bucket', Key: 'videos/abc.mp4' });
  });

  it('throws when STORAGE_BUCKET is not set', async () => {
    delete process.env.STORAGE_BUCKET;
    const { uploadObject } = await import('./index');

    await expect(uploadObject('videos/abc.mp4', Buffer.from(''))).rejects.toThrow(
      'STORAGE_BUCKET is not set',
    );
    expect(sendMock).not.toHaveBeenCalled();
  });

  it('reuses the same S3Client instance across multiple calls (lazy singleton)', async () => {
    sendMock.mockResolvedValue({});
    const { S3Client } = await import('@aws-sdk/client-s3');
    const { uploadObject, deleteObject } = await import('./index');

    await uploadObject('a', Buffer.from(''));
    await deleteObject('a');

    expect(S3Client).toHaveBeenCalledTimes(1);
  });
});
