// The one shape for "this metric has no real data source" across the
// Analytics Dashboard Expansion roadmap - Sprint 6C's per-clip Audience
// section, Sprint 6H's Retention/Drop-off/Replay, and any future honestly-
// unavailable metric. Always `available: false` with a required reason -
// this app never fabricates/estimates a number in its place (see
// platform-capability.util.ts for the equivalent per-platform-per-metric
// concept this generalizes for whole-section, not-tied-to-one-platform
// gaps).
export interface UnavailableSection {
  available: false;
  reason: string;
}
