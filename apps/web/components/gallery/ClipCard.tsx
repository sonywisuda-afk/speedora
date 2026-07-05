import Link from 'next/link';
import type { Clip } from '@speedora/shared';

import { ScoreGauge } from '@/components/ScoreGauge';
import { LiveReel, type LiveReelThumbnail } from '@/components/signature/LiveReel';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';

const TOP_SCORE_THRESHOLD = 90;

// No frame-extraction exists in this backend yet - a neutral, honest
// placeholder (not a fake random-colored "preview") standing in for a real
// thumbnail. Same image for all 3 frames; the filmstrip motif itself is the
// point, not a claim that these are actual frames from the clip.
const PLACEHOLDER_FRAME_SRC = `data:image/svg+xml,${encodeURIComponent(
  '<svg xmlns="http://www.w3.org/2000/svg" width="180" height="320"><rect width="180" height="320" fill="#151922"/><polygon points="76,132 76,188 118,160" fill="#A8B0BE" opacity="0.4"/></svg>',
)}`;

// Just 2 frames, not 3 - each is a fixed w-24 (see LiveReel's
// ThumbnailStripReel), and a 3rd frame overflows/crops at typical grid
// card widths instead of fitting cleanly.
const PLACEHOLDER_THUMBNAILS: LiveReelThumbnail[] = [
  { id: 'a', src: PLACEHOLDER_FRAME_SRC, alt: 'Pratinjau belum tersedia' },
  { id: 'b', src: PLACEHOLDER_FRAME_SRC, alt: 'Pratinjau belum tersedia' },
];

function formatDuration(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.round(seconds % 60);
  return `${m}:${String(s).padStart(2, '0')}`;
}

export function ClipCard({ videoId, clip }: { videoId: string; clip: Clip }) {
  const isTopScore = clip.viralityScore >= TOP_SCORE_THRESHOLD;

  return (
    <Link
      href={`/videos/${videoId}/edit?clip=${clip.id}`}
      className={cn(
        'block overflow-hidden rounded-lg border border-border bg-card transition-all duration-300',
        'motion-safe:hover:-translate-y-0.5 motion-safe:hover:scale-[1.02]',
        'hover:border-signal-pink/50 hover:shadow-[0_0_28px_-8px_rgba(255,59,127,0.4)]',
      )}
    >
      <LiveReel variant="thumbnail-strip" thumbnails={PLACEHOLDER_THUMBNAILS} />

      <div className="p-4">
        <div className="flex items-center justify-between gap-3">
          <ScoreGauge score={clip.viralityScore} size={48} />
          <span className="font-mono text-xs text-muted-foreground">
            {formatDuration(clip.endTime - clip.startTime)}
          </span>
        </div>

        {isTopScore ? (
          <div className="mt-3 flex items-center gap-1.5">
            <span
              className="h-1.5 w-1.5 rounded-full bg-signal-pink motion-safe:animate-pulse-slow"
              aria-hidden="true"
            />
            <span className="font-mono text-[10px] uppercase tracking-wide text-signal-pink">
              Top Pick
            </span>
          </div>
        ) : null}

        {clip.hookText ? (
          <p className="mt-3 line-clamp-2 font-body text-sm text-foreground">
            &quot;{clip.hookText}&quot;
          </p>
        ) : null}

        {clip.hashtags.length > 0 ? (
          <p className="mt-2 font-mono text-xs text-chrome">
            {clip.hashtags.map((tag) => `#${tag}`).join(' ')}
          </p>
        ) : null}

        {clip.reason ? (
          <p className="mt-2 line-clamp-2 font-body text-xs italic text-muted-foreground">
            {clip.reason}
          </p>
        ) : null}

        {clip.topics.length > 0 ? (
          <div className="mt-2 flex flex-wrap gap-1">
            {clip.topics.map((topic) => (
              <Badge key={topic} variant="outline" className="text-[10px]">
                {topic}
              </Badge>
            ))}
          </div>
        ) : null}

        {!clip.downloadUrl ? (
          <p className="mt-2 font-mono text-xs text-muted-foreground">Merender...</p>
        ) : null}
      </div>
    </Link>
  );
}
