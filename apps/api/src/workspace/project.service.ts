import { Injectable, NotFoundException } from '@nestjs/common';
import { recordAuditLog, WorkspaceRole } from '@speedora/database';
import type { ProjectDto } from '@speedora/shared';
import { PrismaService } from '../prisma/prisma.service';
import { WorkspaceAccessService } from './workspace-access.service';

function toDto(project: {
  id: string;
  workspaceId: string;
  name: string;
  createdAt: Date;
  updatedAt: Date;
  archivedAt: Date | null;
}): ProjectDto {
  return {
    id: project.id,
    workspaceId: project.workspaceId,
    name: project.name,
    createdAt: project.createdAt.toISOString(),
    updatedAt: project.updatedAt.toISOString(),
    archivedAt: project.archivedAt ? project.archivedAt.toISOString() : null,
  };
}

// Sprint 5A (Collaboration Foundation). EDITOR+ can create/rename projects
// (day-to-day organization work); ADMIN+ is required to delete one, since
// deleting a Project cascades to its Folders and detaches (not deletes) its
// Videos back to the bare Workspace - a more consequential action than a
// rename. Archive roadmap (P1) adds archive()/unarchive(), EDITOR+ like
// create/rename - reversible, so it doesn't need delete's higher bar.
@Injectable()
export class ProjectService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: WorkspaceAccessService,
  ) {}

  async create(userId: string, workspaceId: string, name: string): Promise<ProjectDto> {
    await this.access.assertMinRole(userId, workspaceId, WorkspaceRole.EDITOR);
    const project = await this.prisma.project.create({ data: { workspaceId, name } });

    await recordAuditLog(this.prisma, {
      workspaceId,
      action: 'PROJECT_CREATED',
      actorId: userId,
      targetType: 'Project',
      targetId: project.id,
      metadata: { name },
    }).catch(() => {});

    return toDto(project);
  }

  // Archive roadmap (P1) - defaults to active-only (archivedAt: null), same
  // "hide by default, opt in to see the rest" posture as Notification's
  // archivedAt filter. includeArchived:true returns every project
  // regardless of archive state, for a future Archived tab.
  async listByWorkspace(
    userId: string,
    workspaceId: string,
    includeArchived = false,
  ): Promise<{ projects: ProjectDto[] }> {
    await this.access.assertMinRole(userId, workspaceId, WorkspaceRole.VIEWER);
    const projects = await this.prisma.project.findMany({
      where: includeArchived ? { workspaceId } : { workspaceId, archivedAt: null },
      orderBy: { createdAt: 'asc' },
      // Stabilization Pass (API Contract Audit) - was fully unbounded.
      take: 200,
    });
    return { projects: projects.map(toDto) };
  }

  private async findOrThrow(projectId: string) {
    const project = await this.prisma.project.findUnique({ where: { id: projectId } });
    if (!project) {
      throw new NotFoundException(`Project ${projectId} not found`);
    }
    return project;
  }

  async get(userId: string, projectId: string): Promise<ProjectDto> {
    const project = await this.findOrThrow(projectId);
    await this.access.assertMinRole(userId, project.workspaceId, WorkspaceRole.VIEWER);
    return toDto(project);
  }

  async update(userId: string, projectId: string, name: string): Promise<ProjectDto> {
    const project = await this.findOrThrow(projectId);
    await this.access.assertMinRole(userId, project.workspaceId, WorkspaceRole.EDITOR);
    const updated = await this.prisma.project.update({ where: { id: projectId }, data: { name } });
    return toDto(updated);
  }

  // Archive roadmap (P1) - EDITOR+ (same rank as create/rename, not
  // ADMIN+ like remove()): archiving is fully reversible and touches
  // nothing but this row, unlike delete's cascade to Folders/Videos.
  async archive(userId: string, projectId: string): Promise<ProjectDto> {
    const project = await this.findOrThrow(projectId);
    await this.access.assertMinRole(userId, project.workspaceId, WorkspaceRole.EDITOR);
    const updated = await this.prisma.project.update({
      where: { id: projectId },
      data: { archivedAt: new Date() },
    });

    await recordAuditLog(this.prisma, {
      workspaceId: project.workspaceId,
      action: 'PROJECT_ARCHIVED',
      actorId: userId,
      targetType: 'Project',
      targetId: projectId,
      metadata: { name: project.name },
    }).catch(() => {});

    return toDto(updated);
  }

  async unarchive(userId: string, projectId: string): Promise<ProjectDto> {
    const project = await this.findOrThrow(projectId);
    await this.access.assertMinRole(userId, project.workspaceId, WorkspaceRole.EDITOR);
    const updated = await this.prisma.project.update({
      where: { id: projectId },
      data: { archivedAt: null },
    });

    await recordAuditLog(this.prisma, {
      workspaceId: project.workspaceId,
      action: 'PROJECT_UNARCHIVED',
      actorId: userId,
      targetType: 'Project',
      targetId: projectId,
      metadata: { name: project.name },
    }).catch(() => {});

    return toDto(updated);
  }

  async remove(userId: string, projectId: string): Promise<void> {
    const project = await this.findOrThrow(projectId);
    await this.access.assertMinRole(userId, project.workspaceId, WorkspaceRole.ADMIN);
    await this.prisma.project.delete({ where: { id: projectId } });

    await recordAuditLog(this.prisma, {
      workspaceId: project.workspaceId,
      action: 'PROJECT_DELETED',
      actorId: userId,
      targetType: 'Project',
      targetId: projectId,
      metadata: { name: project.name },
    }).catch(() => {});
  }
}
