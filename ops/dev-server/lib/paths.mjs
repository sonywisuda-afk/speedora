import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ops/dev-server/lib -> repo root is three levels up.
export const repoRoot = path.resolve(__dirname, '..', '..', '..');

export const devDir = path.join(repoRoot, '.dev');
export const pidDir = path.join(devDir, 'pids');
export const logDir = path.join(devDir, 'logs');
