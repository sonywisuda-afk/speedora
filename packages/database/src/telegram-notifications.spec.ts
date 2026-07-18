import { randomBytes } from 'node:crypto';
import { encryptWebhookUrl } from './webhook-encryption';
import { discoverTelegramChatIds, getTelegramBotInfo } from './telegram-notifications';

describe('telegram-notifications', () => {
  const originalEnv = process.env;
  let fetchMock: jest.Mock;

  beforeEach(() => {
    process.env = { ...originalEnv, TOKEN_ENCRYPTION_KEY: randomBytes(32).toString('hex') };
    fetchMock = jest.fn();
    global.fetch = fetchMock as never;
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  describe('getTelegramBotInfo', () => {
    it('returns the bot username for a valid token', async () => {
      fetchMock.mockResolvedValue({
        ok: true,
        json: async () => ({ ok: true, result: { username: 'my_speedora_bot' } }),
      });

      const result = await getTelegramBotInfo('123:abc');

      expect(fetchMock).toHaveBeenCalledWith(
        'https://api.telegram.org/bot123:abc/getMe',
        expect.objectContaining({ signal: expect.anything() }),
      );
      expect(result).toEqual({ username: 'my_speedora_bot' });
    });

    it('throws for an invalid token (non-ok response)', async () => {
      fetchMock.mockResolvedValue({ ok: false, json: async () => null });

      await expect(getTelegramBotInfo('bad-token')).rejects.toThrow('Invalid Telegram bot token');
    });

    it('throws when Telegram returns ok:false in the body', async () => {
      fetchMock.mockResolvedValue({
        ok: true,
        json: async () => ({ ok: false, description: 'Unauthorized' }),
      });

      await expect(getTelegramBotInfo('bad-token')).rejects.toThrow('Invalid Telegram bot token');
    });
  });

  describe('discoverTelegramChatIds', () => {
    function makePrisma() {
      return {
        notificationWebhook: {
          findMany: jest.fn(),
          update: jest.fn().mockResolvedValue({}),
        },
      };
    }

    function pendingRow(overrides: Record<string, unknown> = {}) {
      return {
        id: 'wh-1',
        userId: 'user-1',
        channel: 'TELEGRAM',
        url: encryptWebhookUrl('123:abc'),
        chatId: null,
        telegramBotUsername: 'my_speedora_bot',
        telegramUpdateOffset: null,
        ...overrides,
      };
    }

    it('makes zero fetch calls when there are no pending rows', async () => {
      const prisma = makePrisma();
      prisma.notificationWebhook.findMany.mockResolvedValue([]);

      await discoverTelegramChatIds(prisma as never);

      expect(prisma.notificationWebhook.findMany).toHaveBeenCalledWith({
        where: { channel: 'TELEGRAM', chatId: null },
      });
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it('persists chatId and advances the offset when a message update is found', async () => {
      const prisma = makePrisma();
      prisma.notificationWebhook.findMany.mockResolvedValue([pendingRow()]);
      fetchMock.mockResolvedValue({
        ok: true,
        json: async () => ({
          ok: true,
          result: [{ update_id: 500, message: { chat: { id: 999888777 } } }],
        }),
      });

      await discoverTelegramChatIds(prisma as never);

      expect(fetchMock).toHaveBeenCalledWith(
        'https://api.telegram.org/bot123:abc/getUpdates?offset=0&timeout=0',
        expect.objectContaining({ signal: expect.anything() }),
      );
      expect(prisma.notificationWebhook.update).toHaveBeenCalledWith({
        where: { id: 'wh-1' },
        data: { telegramUpdateOffset: 501, chatId: '999888777' },
      });
    });

    it('resumes from the persisted offset, not from 0', async () => {
      const prisma = makePrisma();
      prisma.notificationWebhook.findMany.mockResolvedValue([
        pendingRow({ telegramUpdateOffset: 700 }),
      ]);
      fetchMock.mockResolvedValue({ ok: true, json: async () => ({ ok: true, result: [] }) });

      await discoverTelegramChatIds(prisma as never);

      expect(fetchMock).toHaveBeenCalledWith(
        'https://api.telegram.org/bot123:abc/getUpdates?offset=701&timeout=0',
        expect.anything(),
      );
    });

    it('advances the offset even when updates exist but none are a message (chatId stays null)', async () => {
      const prisma = makePrisma();
      prisma.notificationWebhook.findMany.mockResolvedValue([pendingRow()]);
      fetchMock.mockResolvedValue({
        ok: true,
        json: async () => ({ ok: true, result: [{ update_id: 42 }] }),
      });

      await discoverTelegramChatIds(prisma as never);

      expect(prisma.notificationWebhook.update).toHaveBeenCalledWith({
        where: { id: 'wh-1' },
        data: { telegramUpdateOffset: 43 },
      });
    });

    it('does not update the row at all when getUpdates returns no updates', async () => {
      const prisma = makePrisma();
      prisma.notificationWebhook.findMany.mockResolvedValue([pendingRow()]);
      fetchMock.mockResolvedValue({ ok: true, json: async () => ({ ok: true, result: [] }) });

      await discoverTelegramChatIds(prisma as never);

      expect(prisma.notificationWebhook.update).not.toHaveBeenCalled();
    });

    it("isolates one row's failure - other rows are still processed", async () => {
      const prisma = makePrisma();
      prisma.notificationWebhook.findMany.mockResolvedValue([
        pendingRow({ id: 'wh-bad', url: encryptWebhookUrl('bad:token') }),
        pendingRow({ id: 'wh-good', url: encryptWebhookUrl('good:token') }),
      ]);
      fetchMock.mockRejectedValueOnce(new Error('network error')).mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          ok: true,
          result: [{ update_id: 1, message: { chat: { id: 42 } } }],
        }),
      });
      const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});

      await discoverTelegramChatIds(prisma as never);

      expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('wh-bad'), expect.any(Error));
      expect(prisma.notificationWebhook.update).toHaveBeenCalledWith({
        where: { id: 'wh-good' },
        data: { telegramUpdateOffset: 2, chatId: '42' },
      });
      warnSpy.mockRestore();
    });

    it('skips the update write when the Telegram response itself is non-ok', async () => {
      const prisma = makePrisma();
      prisma.notificationWebhook.findMany.mockResolvedValue([pendingRow()]);
      fetchMock.mockResolvedValue({ ok: false, json: async () => null });

      await discoverTelegramChatIds(prisma as never);

      expect(prisma.notificationWebhook.update).not.toHaveBeenCalled();
    });
  });
});
