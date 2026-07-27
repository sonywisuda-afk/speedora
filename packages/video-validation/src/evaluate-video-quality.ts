import type { ValidationReport, VideoQualityMetadata } from '@speedora/contracts';
import { evaluateWarnings } from './rules';

// Quality Validation roadmap (Fase 0 design, Phase 2) - the module's one
// entry point. Pure/stateless (no DB, no subprocess, no I/O) - given the
// same metadata it always produces the same report, same JSON-contract
// pattern every other AI-adjacent module in this codebase follows even
// though this one is deterministic rule evaluation, not AI. errors is
// always [] (see ValidationReport's own comment); info is always [] in
// Phase 2 (Info-tier is the Pre-Processing Settings roadmap's separate
// cost/time estimate feature, not duplicated here).
export function evaluateVideoQuality(metadata: VideoQualityMetadata): ValidationReport {
  return {
    errors: [],
    warnings: evaluateWarnings(metadata),
    info: [],
  };
}
