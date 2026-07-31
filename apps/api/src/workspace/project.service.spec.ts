import { NotFoundException } from '@nestjs/common';
import type { PrismaService } from '../prisma/prisma.service';
import type { WorkspaceAccessService } from './workspace-access.service';
import { ProjectService } from './project.service';

describe('ProjectService', () => {
  let service: ProjectService;
  let prisma: {
    project: {
      create: jest.Mock;
      findMany: jest.Mock;
      findUnique: jest.Mock;
      update: jest.Mock;
      delete: jest.Mock;
    };
    auditLogEntry: { create: jest.Mock };
  };
  let access: { assertMinRole: jest.Mock };

  beforeEach(() => {
    prisma = {
      project: {
        create: jest.fn(),
        findMany: jest.fn(),
        findUnique: jest.fn(),
        update: jest.fn(),
        delete: jest.fn(),
      },
      auditLogEntry: { create: jest.fn().mockResolvedValue({}) },
    };
    access = { assertMinRole: jest.fn().mockResolvedValue('EDITOR') };

    service = new ProjectService(
      prisma as unknown as PrismaService,
      access as unknown as WorkspaceAccessService,
    );
  });

  describe('create', () => {
    it('creates a Project and records an audit log entry', async () => {
      prisma.project.create.mockResolvedValue({
        id: 'project-1',
        workspaceId: 'ws-1',
        name: 'Q3 Campaign',
        createdAt: new Date('2026-07-18T00:00:00.000Z'),
        updatedAt: new Date('2026-07-18T00:00:00.000Z'),
      });

      const result = await service.create('user-1', 'ws-1', 'Q3 Campaign');

      expect(access.assertMinRole).toHaveBeenCalledWith('user-1', 'ws-1', 'EDITOR');
      expect(prisma.project.create).toHaveBeenCalledWith({
        data: { workspaceId: 'ws-1', name: 'Q3 Campaign' },
      });
      expect(prisma.auditLogEntry.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          workspaceId: 'ws-1',
          action: 'PROJECT_CREATED',
          actorId: 'user-1',
          targetType: 'Project',
          targetId: 'project-1',
        }),
      });
      expect(result.id).toBe('project-1');
    });
  });

  describe('remove', () => {
    it('requires ADMIN+, deletes the project, and records an audit log entry', async () => {
      prisma.project.findUnique.mockResolvedValue({
        id: 'project-1',
        workspaceId: 'ws-1',
        name: 'Q3 Campaign',
      });

      await service.remove('admin-1', 'project-1');

      expect(access.assertMinRole).toHaveBeenCalledWith('admin-1', 'ws-1', 'ADMIN');
      expect(prisma.project.delete).toHaveBeenCalledWith({ where: { id: 'project-1' } });
      expect(prisma.auditLogEntry.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          action: 'PROJECT_DELETED',
          targetId: 'project-1',
          metadata: { name: 'Q3 Campaign' },
        }),
      });
    });

    it('throws NotFoundException for a missing project', async () => {
      prisma.project.findUnique.mockResolvedValue(null);

      await expect(service.remove('admin-1', 'missing')).rejects.toThrow(NotFoundException);
      expect(prisma.project.delete).not.toHaveBeenCalled();
    });
  });

  describe('archive', () => {
    it('requires EDITOR+, sets archivedAt, and records an audit log entry', async () => {
      prisma.project.findUnique.mockResolvedValue({
        id: 'project-1',
        workspaceId: 'ws-1',
        name: 'Q3 Campaign',
      });
      prisma.project.update.mockResolvedValue({
        id: 'project-1',
        workspaceId: 'ws-1',
        name: 'Q3 Campaign',
        createdAt: new Date('2026-07-18T00:00:00.000Z'),
        updatedAt: new Date('2026-07-18T00:00:00.000Z'),
        archivedAt: new Date('2026-08-01T00:00:00.000Z'),
      });

      const result = await service.archive('user-1', 'project-1');

      expect(access.assertMinRole).toHaveBeenCalledWith('user-1', 'ws-1', 'EDITOR');
      expect(prisma.project.update).toHaveBeenCalledWith({
        where: { id: 'project-1' },
        data: { archivedAt: expect.any(Date) },
      });
      expect(prisma.auditLogEntry.create).toHaveBeenCalledWith({
        data: expect.objectContaining({ action: 'PROJECT_ARCHIVED', targetId: 'project-1' }),
      });
      expect(result.archivedAt).toBe('2026-08-01T00:00:00.000Z');
    });
  });

  describe('unarchive', () => {
    it('requires EDITOR+, clears archivedAt, and records an audit log entry', async () => {
      prisma.project.findUnique.mockResolvedValue({
        id: 'project-1',
        workspaceId: 'ws-1',
        name: 'Q3 Campaign',
      });
      prisma.project.update.mockResolvedValue({
        id: 'project-1',
        workspaceId: 'ws-1',
        name: 'Q3 Campaign',
        createdAt: new Date('2026-07-18T00:00:00.000Z'),
        updatedAt: new Date('2026-07-18T00:00:00.000Z'),
        archivedAt: null,
      });

      const result = await service.unarchive('user-1', 'project-1');

      expect(prisma.project.update).toHaveBeenCalledWith({
        where: { id: 'project-1' },
        data: { archivedAt: null },
      });
      expect(prisma.auditLogEntry.create).toHaveBeenCalledWith({
        data: expect.objectContaining({ action: 'PROJECT_UNARCHIVED', targetId: 'project-1' }),
      });
      expect(result.archivedAt).toBeNull();
    });
  });

  describe('listByWorkspace', () => {
    it('excludes archived projects by default', async () => {
      prisma.project.findMany.mockResolvedValue([]);

      await service.listByWorkspace('user-1', 'ws-1');

      expect(prisma.project.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { workspaceId: 'ws-1', archivedAt: null } }),
      );
    });

    it('includes archived projects when includeArchived is true', async () => {
      prisma.project.findMany.mockResolvedValue([]);

      await service.listByWorkspace('user-1', 'ws-1', true);

      expect(prisma.project.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { workspaceId: 'ws-1' } }),
      );
    });
  });
});
