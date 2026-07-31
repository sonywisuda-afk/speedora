import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { recordAuditLog, WorkspaceRole } from '@speedora/database';
import type { ProjectBulkActionResultDto, ProjectDto } from '@speedora/shared';
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

  // Move roadmap - ADMIN+ on BOTH the source and target workspace (a
  // cross-workspace boundary change is more consequential than an in-place
  // delete, which only needs ADMIN+ on one side). Restricted to empty
  // projects (zero videos, transitively including ones nested in Folders,
  // since Video.projectId is always set once a video is in a Folder - see
  // Video's own comment) because Video.workspaceId is independent of its
  // project's workspaceId: moving a non-empty project would silently
  // orphan those videos' workspaceId, and Campaign/PublishRecord (which DO
  // carry their own workspaceId, unlike Clip) could end up pointing across
  // a workspace boundary. A future "move with contents" would need to
  // cascade Video.workspaceId and reconcile those cross-workspace refs -
  // deliberately out of scope here.
  async move(userId: string, projectId: string, targetWorkspaceId: string): Promise<ProjectDto> {
    const project = await this.findOrThrow(projectId);
    if (project.workspaceId === targetWorkspaceId) {
      throw new BadRequestException('Project already belongs to this workspace');
    }
    await this.access.assertMinRole(userId, project.workspaceId, WorkspaceRole.ADMIN);
    await this.access.assertMinRole(userId, targetWorkspaceId, WorkspaceRole.ADMIN);

    const videoCount = await this.prisma.video.count({ where: { projectId } });
    if (videoCount > 0) {
      throw new ConflictException(
        `Project still contains ${videoCount} video(s) - move or detach them before moving the project`,
      );
    }

    const sourceWorkspaceId = project.workspaceId;
    const updated = await this.prisma.project.update({
      where: { id: projectId },
      data: { workspaceId: targetWorkspaceId },
    });

    await recordAuditLog(this.prisma, {
      workspaceId: sourceWorkspaceId,
      action: 'PROJECT_MOVED',
      actorId: userId,
      targetType: 'Project',
      targetId: projectId,
      metadata: { name: project.name, targetWorkspaceId },
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

  // Bulk Actions roadmap - each id runs through the SAME single-item method
  // above (archive/unarchive/move/remove), so role checks, business rules
  // (move's empty-project/video-count check), and audit logging are all
  // reused verbatim rather than reimplemented. Sequential (not
  // Promise.all) - batches are capped at 50 by BulkProjectIdsDto, so
  // throughput isn't a concern, and sequential keeps each project's audit
  // log entries in request order. One id failing never aborts the rest -
  // see ProjectBulkActionResultDto's own comment for why partial success is
  // the right shape here (unlike Notification's bulk actions, a Project id
  // can belong to a different workspace with different role/business-rule
  // outcomes per id).
  private async runBulk(
    projectIds: string[],
    op: (id: string) => Promise<unknown>,
  ): Promise<ProjectBulkActionResultDto> {
    const succeeded: string[] = [];
    const failed: { id: string; reason: string }[] = [];
    for (const id of projectIds) {
      try {
        await op(id);
        succeeded.push(id);
      } catch (err) {
        failed.push({ id, reason: err instanceof Error ? err.message : 'Unknown error' });
      }
    }
    return { succeeded, failed };
  }

  bulkArchive(userId: string, projectIds: string[]): Promise<ProjectBulkActionResultDto> {
    return this.runBulk(projectIds, (id) => this.archive(userId, id));
  }

  bulkUnarchive(userId: string, projectIds: string[]): Promise<ProjectBulkActionResultDto> {
    return this.runBulk(projectIds, (id) => this.unarchive(userId, id));
  }

  bulkMove(
    userId: string,
    projectIds: string[],
    targetWorkspaceId: string,
  ): Promise<ProjectBulkActionResultDto> {
    return this.runBulk(projectIds, (id) => this.move(userId, id, targetWorkspaceId));
  }

  bulkRemove(userId: string, projectIds: string[]): Promise<ProjectBulkActionResultDto> {
    return this.runBulk(projectIds, (id) => this.remove(userId, id));
  }
}
