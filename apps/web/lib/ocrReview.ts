import type { Clip, OcrTextCategory, OcrTextTrack } from '@speedora/shared';

// OCR Batch OCR-2.5 follow-up - dataset annotation tooling. User's own
// explicit direction: pause before OCR-3 (object detector), prioritize
// collecting a real annotated dataset instead, and build an annotation UI
// (not a new model) as the highest-value next step - see OcrReviewer.tsx
// for the page itself. This module holds the pure, non-JSX pieces: the
// category order (mirrors @speedora/contracts' OCR_TEXT_CATEGORIES, which
// apps/web can't import - it only depends on @speedora/shared, never
// @speedora/contracts), local-review-state persistence, and the export
// payload builder.

// Same declared order as @speedora/contracts' OCR_TEXT_CATEGORIES - also
// doubles as the 1-6 keyboard shortcut mapping in OcrReviewer.tsx (index 0
// = key "1", etc.).
export const OCR_TEXT_CATEGORIES: OcrTextCategory[] = [
  'subtitle',
  'slide',
  'caption',
  'logo',
  'price',
  'name',
];

export const OCR_CATEGORY_LABELS: Record<OcrTextCategory, string> = {
  subtitle: 'Subtitle',
  slide: 'Slide',
  caption: 'Caption',
  logo: 'Logo',
  price: 'Price',
  name: 'Name',
};

// Contract Governance audit Sprint 3 (Runtime Safety, 2026-08-01) -
// selectedTrack.category is read straight off a detection result (backend
// data, typed OcrTextCategory but not guaranteed to actually be one of the
// 6 known values on a live frontend/backend version skew), unlike
// OCR_TEXT_CATEGORIES.map's own iteration above which is always safe by
// construction. Falls back to the raw value (still legible to a reviewer)
// plus a console.warn, instead of silently rendering nothing.
export function getOcrCategoryLabel(category: string): string {
  if (category in OCR_CATEGORY_LABELS) {
    return OCR_CATEGORY_LABELS[category as OcrTextCategory];
  }
  console.warn(
    `[ocrReview] unknown OcrTextCategory "${category}" - falling back to the raw value. ` +
      'This means the API sent a category this frontend build does not recognize yet.',
  );
  return category;
}

// One entry per REVIEWED track, keyed by "<clipId>:<trackId>" so review
// progress survives switching between a video's clips without needing a
// nested-by-clip structure. Absence of a key means "not yet reviewed" -
// there's no separate boolean flag, the key's presence IS the flag.
export type OcrReviewState = Record<string, OcrTextCategory>;

export function trackKey(clipId: string, trackId: number): string {
  return `${clipId}:${trackId}`;
}

function storageKey(videoId: string): string {
  return `speedora:ocr-review:${videoId}`;
}

// Deliberately local-only (no backend persistence) - this is a dev/internal
// annotation tool, not a user-facing product feature (see CLAUDE.md's
// OCR-2.5 section for why OCR-2.5's own tooling stayed offline/unwired
// too). localStorage is a cheap, honest middle ground: progress survives a
// page refresh in the SAME browser, but isn't shared across devices/
// reviewers - a real multi-reviewer workflow would need a backend, which is
// out of scope until there's evidence this dataset-collection effort needs
// more than one person's browser.
export function loadReviewState(videoId: string): OcrReviewState {
  if (typeof window === 'undefined') return {};
  try {
    const raw = window.localStorage.getItem(storageKey(videoId));
    if (!raw) return {};
    const parsed: unknown = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? (parsed as OcrReviewState) : {};
  } catch {
    return {};
  }
}

export function saveReviewState(videoId: string, state: OcrReviewState): void {
  if (typeof window === 'undefined') return;
  window.localStorage.setItem(storageKey(videoId), JSON.stringify(state));
}

export interface OcrLabeledTrackExport {
  track: OcrTextTrack;
  actualCategory: OcrTextCategory;
}

// Builds the export payload across ALL of a video's clips (not just the
// one currently in view) - a reviewer may work through several clips in one
// session before exporting. Only REVIEWED tracks are included: an
// unreviewed track has no ground truth yet, so including it would silently
// fabricate a label, the exact thing OCR-2.5's "kejujuran skala" stance
// argued against. Field-for-field, this matches @speedora/contracts'
// ocrLabeledTrackSchema shape (apps/web has no dependency on
// @speedora/contracts itself - JSON has no nominal types, so a plain object
// with the same field names/types parses through that schema unmodified).
export function buildExportPayload(
  clips: Pick<Clip, 'id' | 'ocrTracks'>[],
  reviewState: OcrReviewState,
): OcrLabeledTrackExport[] {
  const entries: OcrLabeledTrackExport[] = [];
  for (const clip of clips) {
    for (const track of clip.ocrTracks ?? []) {
      const actualCategory = reviewState[trackKey(clip.id, track.trackId)];
      if (actualCategory) entries.push({ track, actualCategory });
    }
  }
  return entries;
}

export function downloadJson(filename: string, data: unknown): void {
  if (typeof document === 'undefined') return;
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}
