// Root cause (diagnosed 2026-07-22): `npm config get prefix` on this machine
// resolves to a custom prefix (set via a `prefix=...` line in ~/.npmrc, a
// common workaround so `npm install -g` doesn't need an elevated shell on
// Windows, where the default prefix lives under Program Files). `pnpm` was
// installed globally into that custom prefix and the shim (`pnpm.cmd`) is
// genuinely there and works when invoked by full path - but the Windows User
// PATH environment variable was only ever populated with the DEFAULT npm
// prefix (%APPDATA%\npm), never updated when the prefix was customized. So
// `pnpm` resolves to nothing on PATH, while `corepack pnpm` keeps working
// because corepack.cmd ships alongside node.exe itself (already on PATH) and
// resolves/runs the exact pnpm version pinned by package.json's
// "packageManager" field independently of the global npm-global install.
//
// The permanent fix is mechanical: add the custom prefix directory to the
// User PATH once, persistently, via the same Environment.SetEnvironmentVariable
// API `setx`/System Properties use - not by telling developers to keep
// typing `corepack pnpm` forever.
import { execFileSync } from 'node:child_process';
import path from 'node:path';

export function getNpmPrefix() {
  try {
    // `shell: true` is required on Windows - npm.cmd is a batch file, which
    // Windows can only execute through cmd.exe, not directly via
    // CreateProcess. The DEP0190 warning this triggers is about unescaped
    // args in the general case; harmless here since these three args are
    // fixed literals, never user input.
    return execFileSync('npm', ['config', 'get', 'prefix'], {
      encoding: 'utf8',
      windowsHide: true,
      shell: process.platform === 'win32',
    }).trim();
  } catch {
    return null;
  }
}

function normalize(p) {
  return path.resolve(p).toLowerCase().replace(/[/\\]+$/, '');
}

export function isOnPath(dir, pathValue = process.env.PATH ?? '') {
  const target = normalize(dir);
  return pathValue
    .split(path.delimiter)
    .filter(Boolean)
    .some((entry) => normalize(entry) === target);
}

/**
 * Reads the persistent Windows User PATH (not just this process's inherited
 * PATH, which may already differ from what's actually stored), appends
 * `dir` if missing, and writes it back. Idempotent: safe to call every time
 * `pnpm doctor --fix` runs.
 */
export function fixUserPathWindows(dir) {
  const psGet = "[Environment]::GetEnvironmentVariable('Path','User')";
  const current = execFileSync('powershell', ['-NoProfile', '-NonInteractive', '-Command', psGet], {
    encoding: 'utf8',
    windowsHide: true,
  }).trim();

  if (isOnPath(dir, current)) {
    return { changed: false, reason: 'already present' };
  }

  const entries = current.split(';').filter(Boolean);
  entries.push(dir);
  const next = entries.join(';');

  const psSet = `[Environment]::SetEnvironmentVariable('Path', '${next.replace(/'/g, "''")}', 'User')`;
  execFileSync('powershell', ['-NoProfile', '-NonInteractive', '-Command', psSet], {
    windowsHide: true,
  });

  return { changed: true, reason: `appended ${dir} to User PATH` };
}

export function fixPath(dir) {
  if (process.platform === 'win32') {
    return fixUserPathWindows(dir);
  }
  // Best-effort POSIX fallback: not the primary target platform, but keep
  // the tool from being a no-op silently. Appends an export line to
  // ~/.profile, deduping on the exact line, and tells the caller a shell
  // reload is required (same caveat as Windows - env var changes never
  // propagate to already-running shells).
  return { changed: false, reason: 'run: echo \'export PATH="' + dir + ':$PATH"\' >> ~/.profile' };
}
