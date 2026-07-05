import { createWriteStream } from 'node:fs';
import { readFile } from 'node:fs/promises';
import * as path from 'node:path';
import { pipeline } from 'node:stream/promises';
import { config } from 'dotenv';

// Load the root .env before importing anything that reads env at module scope
// (../prisma constructs a PrismaClient from DATABASE_URL; ../ffmpeg reads
// FFMPEG_PATH/FFPROBE_PATH). Everything else below is a dynamic import for the
// same reason main.ts uses them - under `tsx` (native ESM) static imports are
// hoisted above this config() call, which would leave those modules reading an
// unloaded env.
config({ path: path.resolve(__dirname, '../../../../.env'), quiet: true });

// One-off backfill: older videos were imported/stored as AV1 (av01), which a
// browser <video> element can't decode in many browsers - so the timeline
// editor's source preview shows a dead player. New imports now prefer H.264
// (see youtube.ts); this re-encodes the sources of already-stored videos to
// H.264 in place (same object key, same duration/timeline, so clips and
// transcripts stay valid). Idempotent: a source that's already H.264 is
// skipped. Pass a single video id as an argument to convert just that one;
// with no argument, every video with a stored source is checked.
async function main() {
  const { prisma } = await import('../prisma');
  const { getObjectStream, uploadObject } = await import('@speedora/storage');
  const { getVideoCodec, reencodeToH264 } = await import('../ffmpeg');
  const { cleanupTempFile, reserveScratchPath } = await import('../storage');

  const onlyVideoId = process.argv[2];
  const videos = await prisma.video.findMany({
    // A source is only present once the upload/import has finished - a video
    // still IMPORTING (or failed before download) has sourceUrl ''.
    where: onlyVideoId ? { id: onlyVideoId } : { sourceUrl: { not: '' } },
    select: { id: true, sourceUrl: true },
  });

  console.log(`Checking ${videos.length} video(s) for non-H.264 sources...`);
  let converted = 0;
  let skipped = 0;
  let failed = 0;

  for (const video of videos) {
    if (!video.sourceUrl) {
      console.log(`  ${video.id}: no source yet, skip`);
      skipped += 1;
      continue;
    }

    let sourcePath: string | null = null;
    let outputPath: string | null = null;
    try {
      sourcePath = await reserveScratchPath(
        'reencode-src',
        path.extname(video.sourceUrl) || '.mp4',
      );
      await pipeline(await getObjectStream(video.sourceUrl), createWriteStream(sourcePath));

      const codec = await getVideoCodec(sourcePath);
      if (codec === 'h264') {
        console.log(`  ${video.id}: already h264, skip`);
        skipped += 1;
        continue;
      }

      console.log(`  ${video.id}: ${codec || 'unknown'} -> h264, re-encoding...`);
      outputPath = await reserveScratchPath('reencode-out', '.mp4');
      await reencodeToH264(sourcePath, outputPath);

      const buffer = await readFile(outputPath);
      await uploadObject(video.sourceUrl, buffer, 'video/mp4');
      console.log(`  ${video.id}: done (${(buffer.length / 1_000_000).toFixed(1)} MB)`);
      converted += 1;
    } catch (error) {
      console.error(`  ${video.id}: FAILED -`, error instanceof Error ? error.message : error);
      failed += 1;
    } finally {
      if (sourcePath) await cleanupTempFile(sourcePath);
      if (outputPath) await cleanupTempFile(outputPath);
    }
  }

  console.log(`\nDone. Converted ${converted}, skipped ${skipped}, failed ${failed}.`);
  await prisma.$disconnect();
}

main().catch((error) => {
  console.error('[reencode-existing-sources] failed:', error);
  process.exit(1);
});
