import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { evaluateHealthStatus } from '@speedora/video-import-engine';
import { resolveYtDlpBinaryPath } from './ytdlp-bin-path';

const execFileAsync = promisify(execFile);
const VERSION_CHECK_TIMEOUT_MS = 30 * 1000;

// `pnpm yt-dlp:version` - the health-check/version-reporting half of the
// "version-check + manual rollout" update strategy (see docs/worker.md):
// reports the currently installed binary's version and whether it's stale
// relative to the operator-configured YTDLP_MIN_VERSION, without making any
// live network call (no GitHub API request) - see
// packages/video-import-engine/src/health.ts's own comment on why this
// phase stays that simple.
async function main(): Promise<void> {
  const binaryPath = resolveYtDlpBinaryPath();
  const minVersion = process.env.YTDLP_MIN_VERSION ?? null;

  try {
    const { stdout } = await execFileAsync(binaryPath, ['--version'], {
      timeout: VERSION_CHECK_TIMEOUT_MS,
    });
    const version = stdout.trim();
    const status = evaluateHealthStatus(version, minVersion);

    console.log(JSON.stringify({ binaryPath, version, minVersion, status }, null, 2));

    if (status === 'stale') {
      console.error(
        `yt-dlp ${version} is older than the configured minimum ${minVersion}. Run "pnpm yt-dlp:update".`,
      );
      process.exitCode = 1;
    }
  } catch (error) {
    console.error(
      JSON.stringify(
        {
          binaryPath,
          status: 'unreachable',
          error: error instanceof Error ? error.message : String(error),
        },
        null,
        2,
      ),
    );
    process.exitCode = 1;
  }
}

main();
