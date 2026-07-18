-- Sprint 5A (Collaboration Foundation)
-- Hand-written (not `prisma migrate dev`-generated) because this repo has
-- real dev data (8 Users, 18 Videos, 19 PendingInvites at authoring time)
-- and this migration adds required columns to populated tables plus
-- changes PendingInvite.role's enum type - `prisma migrate dev` refuses to
-- run non-interactively for exactly these two reasons. Structure: create
-- new tables/columns nullable -> backfill one personal Workspace per
-- existing User (and point every existing Video/PendingInvite at it) ->
-- tighten to NOT NULL. All in one transaction (Postgres wraps each
-- migration.sql in a transaction automatically), so this is atomic - it
-- either fully lands or fully rolls back, never a half-migrated DB.

-- CreateEnum
CREATE TYPE "WorkspaceRole" AS ENUM ('OWNER', 'ADMIN', 'EDITOR', 'REVIEWER', 'VIEWER');

-- CreateEnum
CREATE TYPE "PendingInviteStatus" AS ENUM ('PENDING', 'ACCEPTED', 'REVOKED');

-- CreateTable
CREATE TABLE "Workspace" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "isPersonal" BOOLEAN NOT NULL DEFAULT false,
    "ownerId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Workspace_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WorkspaceMembership" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "role" "WorkspaceRole" NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WorkspaceMembership_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Project" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Project_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Folder" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "parentId" TEXT,
    "name" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Folder_pkey" PRIMARY KEY ("id")
);

-- AlterTable (nullable for now - tightened to NOT NULL after backfill below)
ALTER TABLE "Video" ADD COLUMN     "workspaceId" TEXT,
ADD COLUMN     "projectId" TEXT,
ADD COLUMN     "folderId" TEXT;

-- AlterTable (workspaceId/tokenHash nullable for now, role stays the old
-- enum type for now - all tightened/migrated after backfill below)
ALTER TABLE "PendingInvite" ADD COLUMN     "workspaceId" TEXT,
ADD COLUMN     "status" "PendingInviteStatus" NOT NULL DEFAULT 'PENDING',
ADD COLUMN     "tokenHash" TEXT;

-- CreateIndex
CREATE INDEX "Workspace_ownerId_idx" ON "Workspace"("ownerId");

-- CreateIndex
CREATE UNIQUE INDEX "WorkspaceMembership_workspaceId_userId_key" ON "WorkspaceMembership"("workspaceId", "userId");

-- CreateIndex
CREATE INDEX "WorkspaceMembership_userId_idx" ON "WorkspaceMembership"("userId");

-- CreateIndex
CREATE INDEX "Project_workspaceId_idx" ON "Project"("workspaceId");

-- CreateIndex
CREATE INDEX "Folder_projectId_idx" ON "Folder"("projectId");

-- CreateIndex
CREATE INDEX "Folder_parentId_idx" ON "Folder"("parentId");

-- CreateIndex
CREATE INDEX "Video_workspaceId_idx" ON "Video"("workspaceId");

-- CreateIndex
CREATE INDEX "Video_projectId_idx" ON "Video"("projectId");

-- CreateIndex
CREATE INDEX "Video_folderId_idx" ON "Video"("folderId");

-- CreateIndex
CREATE INDEX "PendingInvite_workspaceId_status_idx" ON "PendingInvite"("workspaceId", "status");

-- AddForeignKey
ALTER TABLE "Workspace" ADD CONSTRAINT "Workspace_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkspaceMembership" ADD CONSTRAINT "WorkspaceMembership_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkspaceMembership" ADD CONSTRAINT "WorkspaceMembership_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Project" ADD CONSTRAINT "Project_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Folder" ADD CONSTRAINT "Folder_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Folder" ADD CONSTRAINT "Folder_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "Folder"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Video" ADD CONSTRAINT "Video_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Video" ADD CONSTRAINT "Video_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Video" ADD CONSTRAINT "Video_folderId_fkey" FOREIGN KEY ("folderId") REFERENCES "Folder"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PendingInvite" ADD CONSTRAINT "PendingInvite_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- DataMigration: one isPersonal Workspace + OWNER WorkspaceMembership per
-- existing User. IDs are md5-derived rather than Prisma's own cuid()
-- (client-side only, unavailable in raw SQL) or gen_random_uuid()
-- (pgcrypto/core-version dependent, avoided to not assume an extension) -
-- collision odds are negligible (random() + clock_timestamp() + the row's
-- own id as entropy) and nothing else in this codebase parses id format.
INSERT INTO "Workspace" ("id", "name", "isPersonal", "ownerId", "createdAt", "updatedAt")
SELECT md5(random()::text || clock_timestamp()::text || "id"), 'Personal', true, "id", now(), now()
FROM "User";

INSERT INTO "WorkspaceMembership" ("id", "workspaceId", "userId", "role", "createdAt")
SELECT md5(random()::text || clock_timestamp()::text || w."id"), w."id", w."ownerId", 'OWNER', now()
FROM "Workspace" w
WHERE w."isPersonal" = true;

-- DataMigration: point every existing Video at its owner's personal Workspace.
UPDATE "Video" v
SET "workspaceId" = w."id"
FROM "Workspace" w
WHERE w."ownerId" = v."ownerId" AND w."isPersonal" = true;

-- DataMigration: point every existing PendingInvite at its inviter's
-- personal Workspace. These pre-5A rows never had a real accept flow (the
-- old TeamService was a one-way "send an email, log it" action - see its
-- own retired comment) - a real emailed token never existed for them, so
-- they're marked REVOKED (permanently unreachable via the new accept
-- endpoint) rather than left PENDING with a token nobody has.
UPDATE "PendingInvite" p
SET "workspaceId" = w."id",
    "tokenHash" = md5(random()::text || clock_timestamp()::text || p."id") || md5(random()::text || p."email"),
    "status" = 'REVOKED'
FROM "Workspace" w
WHERE w."ownerId" = p."inviterId" AND w."isPersonal" = true;

-- Tighten now-backfilled columns to NOT NULL.
ALTER TABLE "Video" ALTER COLUMN "workspaceId" SET NOT NULL;
ALTER TABLE "PendingInvite" ALTER COLUMN "workspaceId" SET NOT NULL;
ALTER TABLE "PendingInvite" ALTER COLUMN "tokenHash" SET NOT NULL;

-- CreateIndex (deferred until tokenHash is backfilled and non-null)
CREATE UNIQUE INDEX "PendingInvite_tokenHash_key" ON "PendingInvite"("tokenHash");

-- Migrate PendingInvite.role from the retired PendingInviteRole enum to
-- WorkspaceRole. Safe direct cast: every existing label (OWNER/EDITOR/
-- VIEWER) is also a WorkspaceRole label.
ALTER TABLE "PendingInvite" ALTER COLUMN "role" TYPE "WorkspaceRole" USING ("role"::text::"WorkspaceRole");

DROP TYPE "PendingInviteRole";
