import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { chmod, mkdir, rename, writeFile } from 'node:fs/promises';
import * as path from 'node:path';
import { YTDLP_BIN_NAME, YTDLP_LOCAL_PATH } from './ytdlp-bin-path';

const GITHUB_API_BASE = 'https://api.github.com/repos/yt-dlp/yt-dlp/releases';
const REQUEST_HEADERS = { 'User-Agent': 'speedora-yt-dlp-update-script' };

interface GithubReleaseAsset {
  name: string;
  browser_download_url: string;
}

interface GithubRelease {
  tag_name: string;
  assets: GithubReleaseAsset[];
}

function assetNameForPlatform(): string {
  if (process.platform === 'win32') return 'yt-dlp.exe';
  if (process.platform === 'darwin') return 'yt-dlp_macos';
  return 'yt-dlp';
}

async function fetchJson<T>(url: string): Promise<T> {
  const response = await fetch(url, { headers: REQUEST_HEADERS });
  if (!response.ok) throw new Error(`GitHub API request to ${url} failed with ${response.status}`);
  return (await response.json()) as T;
}

async function fetchText(url: string): Promise<string> {
  const response = await fetch(url, { headers: REQUEST_HEADERS });
  if (!response.ok) throw new Error(`Download from ${url} failed with ${response.status}`);
  return response.text();
}

async function fetchBuffer(url: string): Promise<Buffer> {
  const response = await fetch(url, { headers: REQUEST_HEADERS });
  if (!response.ok) throw new Error(`Download from ${url} failed with ${response.status}`);
  return Buffer.from(await response.arrayBuffer());
}

// `pnpm yt-dlp:update [tag]` - the manual half of the "version-check +
// manual rollout" update strategy (see docs/worker.md). Deliberately NOT
// invoked by the running worker process or any job - a human runs this
// (typically as part of rebuilding/redeploying the Docker image, or to
// update a local dev copy), reviews the output, and only then relies on the
// new binary. Verifies the binary's published SHA256 before ever installing
// it, and always keeps the previous binary as a `.previous` backup for
// `pnpm yt-dlp:rollback`.
async function main(): Promise<void> {
  const requestedTag = process.argv[2];
  const releaseUrl = requestedTag
    ? `${GITHUB_API_BASE}/tags/${requestedTag}`
    : `${GITHUB_API_BASE}/latest`;

  const release = await fetchJson<GithubRelease>(releaseUrl);
  const assetName = assetNameForPlatform();
  const asset = release.assets.find((entry) => entry.name === assetName);
  // Confirmed against a real release (2026.07.04): yt-dlp publishes
  // "SHA2-256SUMS", not the more common bare "SHA256SUMS" filename - this
  // was wrong before being caught by an actual `pnpm yt-dlp:update` run
  // against the real GitHub API, not assumed from convention.
  const checksumsAsset = release.assets.find((entry) => entry.name === 'SHA2-256SUMS');

  if (!asset || !checksumsAsset) {
    throw new Error(`Release ${release.tag_name} is missing "${assetName}" or "SHA2-256SUMS"`);
  }

  console.log(`Downloading yt-dlp ${release.tag_name} (${assetName})...`);
  const [binary, checksums] = await Promise.all([
    fetchBuffer(asset.browser_download_url),
    fetchText(checksumsAsset.browser_download_url),
  ]);

  const expectedLine = checksums.split('\n').find((line) => line.trim().endsWith(assetName));
  if (!expectedLine) throw new Error(`SHA256SUMS has no entry for "${assetName}"`);
  const expectedHash = expectedLine.trim().split(/\s+/)[0];
  const actualHash = createHash('sha256').update(binary).digest('hex');
  if (actualHash !== expectedHash) {
    throw new Error(
      `Checksum mismatch for ${assetName}: expected ${expectedHash}, got ${actualHash} - refusing to install`,
    );
  }
  console.log('Checksum verified.');

  await mkdir(path.dirname(YTDLP_LOCAL_PATH), { recursive: true });
  const previousPath = `${YTDLP_LOCAL_PATH}.previous`;

  if (existsSync(YTDLP_LOCAL_PATH)) {
    await rename(YTDLP_LOCAL_PATH, previousPath);
    console.log(`Backed up existing binary to ${previousPath}`);
  }

  await writeFile(YTDLP_LOCAL_PATH, binary);
  if (process.platform !== 'win32') await chmod(YTDLP_LOCAL_PATH, 0o755);

  console.log(`Installed yt-dlp ${release.tag_name} (${YTDLP_BIN_NAME}) at ${YTDLP_LOCAL_PATH}`);
  console.log(
    'Set YTDLP_PATH to this file (or leave it unset to use it automatically) and run "pnpm yt-dlp:version" to confirm. Run "pnpm yt-dlp:rollback" to revert.',
  );
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
