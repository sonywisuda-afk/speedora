// Milestone 5B - reuses ClipCard.tsx's exact "no frame-extraction exists in
// this backend yet" honesty: a neutral placeholder, not a fake preview.
// Single small frame here (not ClipCard's 2-frame filmstrip) - a filmstrip
// doesn't fit a table row. Rendered via CSS backgroundImage, same technique
// LiveReel.tsx already uses for its own thumbnail frames, rather than an
// <img> tag.
const PLACEHOLDER_FRAME_SRC = `data:image/svg+xml,${encodeURIComponent(
  '<svg xmlns="http://www.w3.org/2000/svg" width="90" height="160"><rect width="90" height="160" fill="#151922"/><polygon points="38,66 38,94 59,80" fill="#A8B0BE" opacity="0.4"/></svg>',
)}`;

export interface ClipThumbnailProps {
  // Product Experience roadmap - already the full absolute URL (built by
  // the caller via lib/api.ts's clipThumbnailUrl), not a raw storage key or
  // relative endpoint path. Undefined/null falls back to the honest
  // placeholder above rather than a broken CSS background-image.
  thumbnailUrl?: string | null;
}

export function ClipThumbnail({ thumbnailUrl }: ClipThumbnailProps) {
  return (
    <div
      role="img"
      aria-label={thumbnailUrl ? 'Pratinjau klip' : 'Pratinjau belum tersedia'}
      // content-visibility:auto (Phase 2, image optimization roadmap) - the
      // lazy-loading equivalent for a CSS background-image div; a table can
      // have many rows, most offscreen at once.
      className="h-16 w-9 shrink-0 rounded-sm border border-border bg-cover bg-center [content-visibility:auto]"
      style={{ backgroundImage: `url("${thumbnailUrl ?? PLACEHOLDER_FRAME_SRC}")` }}
    />
  );
}
