import { z } from 'zod';

// Shared convention (not one single Zod schema, since every module's raw/
// features shapes differ) for every AI Fusion roadmap signal module
// (audio/scene/facial - and gesture/eye-contact/visual as they're built):
// a module's *persisted* output is always `{ raw: T[], features: F }`.
//
//   - `raw` is the untouched per-sample timeline (whatever the detection/
//     classification subprocess or ffmpeg call actually produced) - kept
//     around for debugging and future re-analysis, never deleted just
//     because a summary exists.
//   - `features` is a flat, JSON-serializable object of numbers/strings/
//     booleans/nulls - the dense, pre-aggregated summary the Fusion Engine
//     (Mini Fusion Engine v1 and its later extensions, see
//     packages/contracts/src/fusion.ts) actually consumes. Fusion should
//     never need to re-derive statistics from a raw timeline itself, or
//     special-case one module's raw shape vs another's - it only ever
//     reads each module's `features` object.
//
// A detection/classification module's own exported function (e.g.
// detectFacialEmotion, detectSceneCuts) keeps returning bare `raw` - no
// signature change to code that's already built and verified. Deriving
// `features` from that raw output is a SEPARATE, pure, synchronous export
// per module (e.g. deriveFacialEmotionFeatures) - the adapter
// (apps/worker/src/workers/render-clip.worker.ts) calls both and persists
// the `{ raw, features }` shape into the DB.
//
// intelligenceSignalSchema() is a helper for defining that persisted shape
// per module - use it when documenting/validating the wrapped shape (the
// bare `raw` schema for the module's own function stays whatever it already
// is).
export function intelligenceSignalSchema<TRaw extends z.ZodTypeAny, TFeatures extends z.ZodTypeAny>(
  raw: TRaw,
  features: TFeatures,
) {
  return z.object({ raw: z.array(raw), features });
}
