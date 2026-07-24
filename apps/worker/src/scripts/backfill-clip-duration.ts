import * as path from 'node:path';
import { config } from 'dotenv';

// Load the root .env before importing anything that reads env at module scope
// (../prisma constructs a PrismaClient from DATABASE_URL) - same reasoning as
// reencode-existing-sources.ts's own config() call.
config({ path: path.resolve(__dirname, '../../../../.env'), quiet: true });

// One-off backfill: AI Clip Library roadmap (P1) added Clip.durationSeconds,
// set going forward at every write site that sets startTime/endTime
// (detect-clips.worker.ts's clip creation, ClipsService.update's manual
// trim) - this fills it in for every pre-existing row where it's still
// null. Idempotent: only touches rows where durationSeconds is null.
async function main() {
  const { prisma } = await import('../prisma');

  const clips = await prisma.clip.findMany({
    where: { durationSeconds: null },
    select: { id: true, startTime: true, endTime: true },
  });

  console.log(`Backfilling durationSeconds for ${clips.length} clip(s)...`);

  let updated = 0;
  for (const clip of clips) {
    await prisma.clip.update({
      where: { id: clip.id },
      data: { durationSeconds: clip.endTime - clip.startTime },
    });
    updated += 1;
  }

  console.log(`Done. Backfilled ${updated} clip(s).`);
  await prisma.$disconnect();
}

main().catch((error) => {
  console.error('[backfill-clip-duration] failed:', error);
  process.exit(1);
});
