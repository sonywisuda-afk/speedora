'use client';

import { memo, useState } from 'react';
import type { VideoWithClips } from '@speedora/shared';
import { Film } from 'lucide-react';
import { List, type RowComponentProps } from 'react-window';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { videoStatusBadge } from '@/lib/analytics';
import { formatDuration } from '@/lib/dashboard';
import { videoThumbnailUrl } from '@/lib/api';
import { cn } from '@/lib/utils';

export interface RecentProjectsGridProps {
  videos: VideoWithClips[];
}

const TONE_CLASSES: Record<'good' | 'neutral' | 'bad', string> = {
  good: 'border-emerald-500/40 text-emerald-400',
  neutral: 'border-border text-muted-foreground',
  bad: 'border-rose-500/40 text-rose-400',
};

// Only switches to a virtualized single-column list past this many loaded
// videos (GET /videos pages at 20 by default - see lib/api.ts's listVideos -
// so the common case never hits this). react-window v2's Grid component
// needs a known, non-responsive column width/count ahead of render, which
// doesn't fit this grid's Tailwind sm:/lg: responsive column breakpoints
// without tracking container width in JS - not worth the complexity for a
// case that mainly matters once a user has clicked "Load More" repeatedly.
const VIRTUALIZE_THRESHOLD = 30;
const ROW_HEIGHT_PX = 168;

// Phase 2 (image optimization roadmap) - blur-up loading: if a
// thumbnailBlurDataUrl exists, it's shown as the container's background
// immediately (a real, if tiny, preview - not a generic skeleton), and the
// real image fades in over it once loaded. Falls back to a plain Skeleton
// when there's no blur data yet (extraction pending/failed) but a real
// thumbnail is on the way. Still the honest gradient+Film placeholder when
// there's no thumbnailUrl at all - never a broken-image icon.
const ThumbnailImage = memo(function ThumbnailImage({ video }: { video: VideoWithClips }) {
  const [loaded, setLoaded] = useState(false);

  if (!video.thumbnailUrl) {
    return (
      <div className="flex aspect-video items-center justify-center rounded-t-lg bg-gradient-to-br from-slate-panel to-bay-black">
        <Film className="h-8 w-8 text-chrome" aria-hidden="true" />
      </div>
    );
  }

  return (
    <div
      className="relative aspect-video w-full overflow-hidden rounded-t-lg bg-slate-panel bg-cover bg-center"
      style={
        video.thumbnailBlurDataUrl
          ? { backgroundImage: `url("${video.thumbnailBlurDataUrl}")` }
          : undefined
      }
    >
      {!loaded && !video.thumbnailBlurDataUrl && <Skeleton className="absolute inset-0" />}
      {/* crossOrigin="use-credentials" matches this app's existing
          <video crossOrigin="use-credentials"> convention for cross-origin
          authenticated media (api runs on a different port than web) - the
          thumbnail endpoint is JwtAuthGuard-protected.

          Both onLoad AND a ref check for .complete are needed - confirmed via
          a real browser test that a cached/fast-loading <img> can fire its
          `load` event before React finishes attaching the onLoad handler,
          leaving `loaded` stuck false (and the image stuck at opacity-0)
          forever even though it's fully rendered. The ref callback runs on
          mount and catches exactly that case; onLoad still covers the
          normal, slower-loading case. */}
      <img
        ref={(el) => {
          if (el?.complete) setLoaded(true);
        }}
        src={videoThumbnailUrl(video.thumbnailUrl)}
        crossOrigin="use-credentials"
        loading="lazy"
        alt=""
        onLoad={() => setLoaded(true)}
        className={cn(
          'h-full w-full object-cover transition-opacity duration-300',
          loaded ? 'opacity-100' : 'opacity-0',
        )}
      />
    </div>
  );
});

// At-a-glance summary layer above the existing detailed per-video
// clip-gallery list - clicking a card scrolls to that video's existing
// detail block below (anchored via #video-<id>, see
// components/dashboard/DashboardClient.tsx) rather than duplicating the
// publish/schedule/delete state machine that already lives there.
const ProjectCard = memo(function ProjectCard({ video }: { video: VideoWithClips }) {
  const badge = videoStatusBadge(video.status);
  return (
    <a href={`#video-${video.id}`} className="block">
      <Card className="transition-colors hover:border-signal-pink/60">
        <ThumbnailImage video={video} />
        <CardContent className="space-y-1.5 p-4">
          <p className="truncate font-body text-sm text-foreground">
            {video.title ?? 'Video Tanpa Judul'}
          </p>
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="outline" className={TONE_CLASSES[badge.tone]}>
              {badge.label}
            </Badge>
            <span className="font-mono text-xs text-muted-foreground">
              {formatDuration(video.durationSeconds)}
            </span>
            <span className="font-mono text-xs text-muted-foreground">
              {video.clips.length} klip
            </span>
          </div>
          <p className="font-mono text-[10px] text-muted-foreground">
            {new Date(video.createdAt).toLocaleDateString()}
          </p>
        </CardContent>
      </Card>
    </a>
  );
});

function ProjectRow({ index, style, videos }: RowComponentProps<{ videos: VideoWithClips[] }>) {
  return (
    <div style={style} className="px-0.5 pb-3">
      <ProjectCard video={videos[index]} />
    </div>
  );
}

export function RecentProjectsGrid({ videos }: RecentProjectsGridProps) {
  if (videos.length > VIRTUALIZE_THRESHOLD) {
    return (
      <List
        rowComponent={ProjectRow}
        rowCount={videos.length}
        rowHeight={ROW_HEIGHT_PX}
        rowProps={{ videos }}
        defaultHeight={ROW_HEIGHT_PX * 4}
        style={{ height: ROW_HEIGHT_PX * 4 }}
      />
    );
  }

  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
      {videos.map((video) => (
        <ProjectCard key={video.id} video={video} />
      ))}
    </div>
  );
}
