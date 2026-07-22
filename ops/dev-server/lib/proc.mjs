// Cross-platform process enumeration, tree-kill, and port-ownership lookup.
// Windows is the primary target (see CLAUDE.md); POSIX paths are kept
// genuinely functional (not stubs) since Turbo/pnpm/CI may run this on
// Linux/macOS too, but are exercised less here.
import { execFileSync, spawnSync } from 'node:child_process';
import net from 'node:net';

const isWin = process.platform === 'win32';

/**
 * Returns every currently running process as { pid, ppid, command }.
 * `command` is the full command line (or as close as the OS exposes).
 */
export function listProcesses() {
  if (isWin) {
    // Get-CimInstance (WMI) - not `wmic` (deprecated, being removed from
    // Windows; also mangles wide-character output in some shells).
    const script =
      'Get-CimInstance Win32_Process | Select-Object ProcessId,ParentProcessId,CommandLine,Name | ConvertTo-Json -Compress';
    const out = execFileSync('powershell', ['-NoProfile', '-NonInteractive', '-Command', script], {
      encoding: 'utf8',
      windowsHide: true,
      maxBuffer: 32 * 1024 * 1024,
    });
    const parsed = JSON.parse(out);
    const rows = Array.isArray(parsed) ? parsed : [parsed];
    return rows.map((r) => ({
      pid: r.ProcessId,
      ppid: r.ParentProcessId,
      command: r.CommandLine ?? r.Name ?? '',
    }));
  }

  const out = execFileSync('ps', ['-eo', 'pid,ppid,command'], { encoding: 'utf8' });
  return out
    .split('\n')
    .slice(1)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const m = line.match(/^(\d+)\s+(\d+)\s+(.*)$/);
      if (!m) return null;
      return { pid: Number(m[1]), ppid: Number(m[2]), command: m[3] };
    })
    .filter(Boolean);
}

export function isAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

/**
 * Kills a process AND its full descendant tree. This is the key structural
 * fix for the orphan-process class of bug: every service in this
 * supervisor is spawned via `shell: true` (so `corepack pnpm --filter X dev`
 * resolves correctly - see npmpath.mjs for why bare `pnpm` can't be trusted
 * on PATH), which means the recorded PID is a shell/wrapper process with the
 * real dev server as a grandchild. Killing only the recorded PID leaves the
 * grandchild running and detached - exactly how ~20 orphans accumulated
 * before this system existed. `/T` (Windows) / killing the process group
 * (POSIX) always kills the whole subtree in one call, regardless of how
 * many wrapper layers deep the real process is.
 */
export function killTree(pid, { signal = 'SIGTERM' } = {}) {
  if (!isAlive(pid)) return;
  if (isWin) {
    spawnSync('taskkill', ['/PID', String(pid), '/T', '/F'], { windowsHide: true });
    return;
  }
  try {
    // Negative pid = kill the whole process group. Requires the child to
    // have been spawned with `detached: true` (see spawnService in dev.mjs).
    process.kill(-pid, signal);
  } catch {
    try {
      process.kill(pid, signal);
    } catch {
      // already gone
    }
  }
}

/**
 * Kills exactly one process, NOT its descendants - the deliberate opposite
 * of killTree. Needed when taking over from a previous orchestrator
 * instance: that process's children are the actual dev servers we want to
 * KEEP running and adopt, not destroy. Tree-killing the old orchestrator
 * would take its whole subtree down with it, defeating the entire point of
 * "reuse a healthy running instance instead of restarting it".
 */
export function killSingle(pid) {
  if (!isAlive(pid)) return;
  if (isWin) {
    spawnSync('taskkill', ['/PID', String(pid), '/F'], { windowsHide: true });
    return;
  }
  try {
    process.kill(pid, 'SIGTERM');
  } catch {
    // already gone
  }
}

/** True if some process is currently accepting connections on `port`. */
export function portInUse(port, host = '127.0.0.1') {
  return new Promise((resolve) => {
    const socket = net.connect({ port, host, timeout: 500 });
    socket.once('connect', () => {
      socket.destroy();
      resolve(true);
    });
    socket.once('timeout', () => {
      socket.destroy();
      resolve(false);
    });
    socket.once('error', () => resolve(false));
  });
}

/** PIDs of processes with a LISTENing socket on `port`, deduped. */
export function findPidsOnPort(port) {
  if (isWin) {
    let out;
    try {
      out = execFileSync('netstat', ['-ano'], { encoding: 'utf8', windowsHide: true });
    } catch {
      return [];
    }
    const pids = new Set();
    for (const line of out.split('\n')) {
      const m = line.match(/^\s*TCP\s+\S*:(\d+)\s+\S+\s+LISTENING\s+(\d+)/i);
      if (m && Number(m[1]) === port) pids.add(Number(m[2]));
    }
    return [...pids];
  }

  const result = spawnSync('lsof', ['-i', `:${port}`, '-sTCP:LISTEN', '-t'], { encoding: 'utf8' });
  if (result.status !== 0 || !result.stdout) return [];
  return result.stdout
    .split('\n')
    .map((s) => s.trim())
    .filter(Boolean)
    .map(Number);
}

/** Full command line for a single live pid, or null if it's gone. */
export function commandOf(pid) {
  if (isWin) {
    try {
      const script = `Get-CimInstance Win32_Process -Filter "ProcessId=${pid}" | Select-Object -ExpandProperty CommandLine`;
      const out = execFileSync('powershell', ['-NoProfile', '-NonInteractive', '-Command', script], {
        encoding: 'utf8',
        windowsHide: true,
      });
      return out.trim() || null;
    } catch {
      return null;
    }
  }
  try {
    const out = execFileSync('ps', ['-o', 'command=', '-p', String(pid)], { encoding: 'utf8' });
    return out.trim() || null;
  } catch {
    return null;
  }
}
