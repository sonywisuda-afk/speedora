import { existsSync } from 'node:fs';
import { rename } from 'node:fs/promises';
import { YTDLP_LOCAL_PATH } from './ytdlp-bin-path';

// `pnpm yt-dlp:rollback` - restores the binary `pnpm yt-dlp:update` backed
// up before installing its replacement. Refuses to do anything if there's
// no backup, rather than silently no-op'ing.
async function main(): Promise<void> {
  const previousPath = `${YTDLP_LOCAL_PATH}.previous`;
  const setAsidePath = `${YTDLP_LOCAL_PATH}.rolled-back`;

  if (!existsSync(previousPath)) {
    throw new Error(`No backup found at ${previousPath} - nothing to roll back to.`);
  }

  if (existsSync(YTDLP_LOCAL_PATH)) {
    await rename(YTDLP_LOCAL_PATH, setAsidePath);
  }
  await rename(previousPath, YTDLP_LOCAL_PATH);

  console.log(`Rolled back to the previous yt-dlp binary at ${YTDLP_LOCAL_PATH}.`);
  if (existsSync(setAsidePath)) {
    console.log(`The binary rolled back from was moved to ${setAsidePath}.`);
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
