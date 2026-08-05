import * as path from 'node:path';
import { config } from 'dotenv';

config({ path: path.resolve(__dirname, '../../../../.env'), quiet: true });

// Activity Timeline v2 - one-off backfill for ActivityEvent rows written
// before the title/description migration (see ActivityEvent.title's own
// schema comment for why they're denormalized). Idempotent
// (`where: { title: null }` - a row already backfilled is never
// re-touched, safe to rerun) and batched (`take: BATCH_SIZE` loop, not one
// giant findMany, so this stays cheap regardless of table size). Run once
// after the migration deploys - GET /dashboard/activity's search simply
// never matches a not-yet-backfilled row until this runs (the correct
// degrade, not a bug - see dashboard.service.ts's getActivity).
//
// Usage: pnpm --filter @speedora/api backfill-activity-descriptions
const BATCH_SIZE = 500;

async function main() {
  const { PrismaClient, PrismaPg, mapActivityEventType } = await import('@speedora/database');
  const { describeActivityEvent } = await import('@speedora/shared');
  const prisma = new PrismaClient({
    adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }),
  });

  let totalUpdated = 0;
  for (;;) {
    const rows = await prisma.activityEvent.findMany({
      where: { title: null },
      take: BATCH_SIZE,
      select: { id: true, type: true, metadata: true },
    });
    if (rows.length === 0) break;

    for (const row of rows) {
      const { title, description } = describeActivityEvent(
        mapActivityEventType(row.type),
        (row.metadata as Record<string, unknown> | null) ?? null,
      );
      await prisma.activityEvent.update({
        where: { id: row.id },
        data: { title, description },
      });
    }
    totalUpdated += rows.length;
    console.log(`[backfill-activity-descriptions] updated ${totalUpdated} rows so far...`);

    // Fewer rows than a full batch means we've reached the end - avoids one
    // extra, always-empty findMany at the tail.
    if (rows.length < BATCH_SIZE) break;
  }

  console.log(`[backfill-activity-descriptions] done - ${totalUpdated} row(s) updated.`);
  await prisma.$disconnect();
}

if (require.main === module) {
  main().catch((error) => {
    console.error('[backfill-activity-descriptions] failed:', error);
    process.exit(1);
  });
}
