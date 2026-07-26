import { YtDlpEngine } from './engines/ytDlpEngine';
import { assertAllowedDomain } from './urlValidation';
import type { VideoImportEngine, VideoImportEngineConfig } from './types';

// Config-driven selection - today a single-entry table. The seam a future
// engine (VimeoEngine, etc.) plugs into: add a row here with its own
// allowlist. Routing is config-driven; writing a new engine implementation
// is still real code, not something this file automates.
const ENGINES: readonly VideoImportEngine[] = [YtDlpEngine];

export function resolveEngine(url: string, config: VideoImportEngineConfig): VideoImportEngine {
  const engine = ENGINES[0];
  assertAllowedDomain(url, config.allowedDomains, engine.name);
  return engine;
}
