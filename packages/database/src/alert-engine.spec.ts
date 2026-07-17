import { Prisma } from './generated/prisma/client';
import {
  findUsersByRoles,
  runAlertRules,
  type AlertInstance,
  type AlertRule,
} from './alert-engine';

function makePrisma() {
  return {
    alertState: {
      findUnique: jest.fn(),
      create: jest.fn(),
      delete: jest.fn(),
    },
    notification: { create: jest.fn().mockResolvedValue({ id: 'notif-1' }) },
    notificationPreference: { findUnique: jest.fn().mockResolvedValue(null) },
    user: { findMany: jest.fn() },
  };
}

function rule(instances: AlertInstance[]): AlertRule {
  return { name: 'test-rule', evaluate: jest.fn().mockResolvedValue(instances) };
}

const notification = {
  type: 'STORAGE_WARNING' as never,
  title: 'Peringatan kapasitas penyimpanan',
  body: 'Penyimpanan hampir penuh.',
};

describe('runAlertRules', () => {
  it('creates AlertState and notifies each recipient on a clean breach', async () => {
    const prisma = makePrisma();
    prisma.alertState.findUnique.mockResolvedValue(null);
    prisma.alertState.create.mockResolvedValue({});
    const testRule = rule([
      {
        dedupeKey: 'storage-warning',
        breached: true,
        recipientUserIds: ['user-1', 'user-2'],
        notification,
      },
    ]);

    const result = await runAlertRules(prisma as never, [testRule]);

    expect(prisma.alertState.create).toHaveBeenCalledWith({
      data: { dedupeKey: 'storage-warning' },
    });
    expect(prisma.notification.create).toHaveBeenCalledTimes(2);
    expect(result).toEqual({ evaluated: 1, notified: 2 });
  });

  it('does not re-notify while the alert is still breached (AlertState already exists)', async () => {
    const prisma = makePrisma();
    prisma.alertState.findUnique.mockResolvedValue({ dedupeKey: 'storage-warning' });
    const testRule = rule([
      { dedupeKey: 'storage-warning', breached: true, recipientUserIds: ['user-1'], notification },
    ]);

    await runAlertRules(prisma as never, [testRule]);

    expect(prisma.alertState.create).not.toHaveBeenCalled();
    expect(prisma.notification.create).not.toHaveBeenCalled();
  });

  it('deletes AlertState and does not notify when the condition clears', async () => {
    const prisma = makePrisma();
    prisma.alertState.findUnique.mockResolvedValue({ dedupeKey: 'storage-warning' });
    const testRule = rule([
      { dedupeKey: 'storage-warning', breached: false, recipientUserIds: [], notification },
    ]);

    await runAlertRules(prisma as never, [testRule]);

    expect(prisma.alertState.delete).toHaveBeenCalledWith({
      where: { dedupeKey: 'storage-warning' },
    });
    expect(prisma.notification.create).not.toHaveBeenCalled();
  });

  it('notifies again after a re-breach following a clear', async () => {
    const prisma = makePrisma();
    prisma.alertState.findUnique.mockResolvedValue(null); // already cleared/re-armed
    prisma.alertState.create.mockResolvedValue({});
    const testRule = rule([
      { dedupeKey: 'storage-warning', breached: true, recipientUserIds: ['user-1'], notification },
    ]);

    const result = await runAlertRules(prisma as never, [testRule]);

    expect(prisma.alertState.create).toHaveBeenCalled();
    expect(prisma.notification.create).toHaveBeenCalledTimes(1);
    expect(result.notified).toBe(1);
  });

  it('swallows a concurrent-create race (P2002) without notifying or throwing', async () => {
    const prisma = makePrisma();
    prisma.alertState.findUnique.mockResolvedValue(null);
    prisma.alertState.create.mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
        code: 'P2002',
        clientVersion: '5.0.0',
      }),
    );
    const testRule = rule([
      { dedupeKey: 'storage-warning', breached: true, recipientUserIds: ['user-1'], notification },
    ]);

    await expect(runAlertRules(prisma as never, [testRule])).resolves.toEqual({
      evaluated: 1,
      notified: 0,
    });
    expect(prisma.notification.create).not.toHaveBeenCalled();
  });

  it('rethrows a non-P2002 error from AlertState.create', async () => {
    const prisma = makePrisma();
    prisma.alertState.findUnique.mockResolvedValue(null);
    prisma.alertState.create.mockRejectedValue(new Error('db is down'));
    const testRule = rule([
      { dedupeKey: 'storage-warning', breached: true, recipientUserIds: ['user-1'], notification },
    ]);

    await expect(runAlertRules(prisma as never, [testRule])).rejects.toThrow('db is down');
  });

  it('logs and continues when one rule throws, without skipping the remaining rules', async () => {
    const prisma = makePrisma();
    prisma.alertState.findUnique.mockResolvedValue(null);
    prisma.alertState.create.mockResolvedValue({});
    const failingRule: AlertRule = {
      name: 'failing-rule',
      evaluate: jest.fn().mockRejectedValue(new Error('S3 unreachable')),
    };
    const okRule = rule([
      {
        dedupeKey: 'credit-warning:user-1',
        breached: true,
        recipientUserIds: ['user-1'],
        notification,
      },
    ]);
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});

    const result = await runAlertRules(prisma as never, [failingRule, okRule]);

    expect(result).toEqual({ evaluated: 1, notified: 1 });
    expect(warnSpy).toHaveBeenCalled();
    warnSpy.mockRestore();
  });

  it('passes deps.publish through to recordNotification', async () => {
    const prisma = makePrisma();
    prisma.alertState.findUnique.mockResolvedValue(null);
    prisma.alertState.create.mockResolvedValue({});
    const publish = jest.fn().mockResolvedValue(undefined);
    const testRule = rule([
      { dedupeKey: 'storage-warning', breached: true, recipientUserIds: ['user-1'], notification },
    ]);

    await runAlertRules(prisma as never, [testRule], { publish });

    expect(publish).toHaveBeenCalledWith({
      userId: 'user-1',
      notificationId: 'notif-1',
      type: 'STORAGE_WARNING',
    });
  });
});

describe('findUsersByRoles', () => {
  it('queries users whose role is in the given list, selecting only id', async () => {
    const findMany = jest.fn().mockResolvedValue([{ id: 'user-1' }, { id: 'user-2' }]);
    const prisma = { user: { findMany } };

    const result = await findUsersByRoles(prisma as never, ['ADMIN', 'OPERATOR'] as never);

    expect(findMany).toHaveBeenCalledWith({
      where: { role: { in: ['ADMIN', 'OPERATOR'] } },
      select: { id: true },
    });
    expect(result).toEqual([{ id: 'user-1' }, { id: 'user-2' }]);
  });
});
