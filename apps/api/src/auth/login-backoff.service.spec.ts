import { LoginBackoffService } from './login-backoff.service';

const mockRedisClient = {
  hget: jest.fn(),
  hincrby: jest.fn(),
  hset: jest.fn(),
  expire: jest.fn(),
  del: jest.fn(),
  quit: jest.fn(),
};

jest.mock('ioredis', () => ({
  Redis: jest.fn().mockImplementation(() => mockRedisClient),
}));

describe('LoginBackoffService', () => {
  let service: LoginBackoffService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new LoginBackoffService();
  });

  describe('checkAllowed', () => {
    it('allows the attempt when no backoff key exists yet', async () => {
      mockRedisClient.hget.mockResolvedValue(null);

      const result = await service.checkAllowed('a@example.com');

      expect(mockRedisClient.hget).toHaveBeenCalledWith(
        'login-backoff:a@example.com',
        'nextAllowedAt',
      );
      expect(result).toEqual({ allowed: true, retryAfterMs: 0 });
    });

    it('allows the attempt once nextAllowedAt has passed', async () => {
      mockRedisClient.hget.mockResolvedValue(String(Date.now() - 1000));

      const result = await service.checkAllowed('a@example.com');

      expect(result).toEqual({ allowed: true, retryAfterMs: 0 });
    });

    it('blocks the attempt with the remaining delay when still within the backoff window', async () => {
      mockRedisClient.hget.mockResolvedValue(String(Date.now() + 5000));

      const result = await service.checkAllowed('a@example.com');

      expect(result.allowed).toBe(false);
      expect(result.retryAfterMs).toBeGreaterThan(0);
      expect(result.retryAfterMs).toBeLessThanOrEqual(5000);
    });

    it('normalizes email case/whitespace into the same Redis key', async () => {
      mockRedisClient.hget.mockResolvedValue(null);

      await service.checkAllowed('  A@Example.com  ');

      expect(mockRedisClient.hget).toHaveBeenCalledWith(
        'login-backoff:a@example.com',
        'nextAllowedAt',
      );
    });
  });

  describe('recordFailure', () => {
    it('does not set a delay for the first 3 failures', async () => {
      mockRedisClient.hincrby.mockResolvedValue(3);

      await service.recordFailure('a@example.com');

      expect(mockRedisClient.hset).not.toHaveBeenCalled();
      expect(mockRedisClient.expire).toHaveBeenCalledWith('login-backoff:a@example.com', 1800);
    });

    it('sets a growing nextAllowedAt delay beyond the free attempts', async () => {
      mockRedisClient.hincrby.mockResolvedValue(4);

      await service.recordFailure('a@example.com');

      expect(mockRedisClient.hset).toHaveBeenCalledWith(
        'login-backoff:a@example.com',
        'nextAllowedAt',
        expect.any(Number),
      );
      const [, , nextAllowedAt] = mockRedisClient.hset.mock.calls[0];
      expect(nextAllowedAt).toBeGreaterThan(Date.now());
    });

    it('caps the delay at the maximum', async () => {
      mockRedisClient.hincrby.mockResolvedValue(20);

      await service.recordFailure('a@example.com');

      const [, , nextAllowedAt] = mockRedisClient.hset.mock.calls[0];
      expect(nextAllowedAt).toBeLessThanOrEqual(Date.now() + 300_000 + 100);
    });
  });

  describe('reset', () => {
    it('deletes the backoff key', async () => {
      await service.reset('a@example.com');

      expect(mockRedisClient.del).toHaveBeenCalledWith('login-backoff:a@example.com');
    });
  });

  describe('getFailureCount', () => {
    it('returns 0 when no count is stored', async () => {
      mockRedisClient.hget.mockResolvedValue(null);

      const count = await service.getFailureCount('a@example.com');

      expect(count).toBe(0);
    });

    it('returns the stored count', async () => {
      mockRedisClient.hget.mockResolvedValue('5');

      const count = await service.getFailureCount('a@example.com');

      expect(count).toBe(5);
    });
  });
});
