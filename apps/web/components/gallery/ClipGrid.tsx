'use client';

import { useMemo, useState } from 'react';
import { ChevronDown, ChevronUp } from 'lucide-react';
import type { Clip } from '@speedora/shared';

import { ClipCard } from '@/components/gallery/ClipCard';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

type SortKey = 'score' | 'duration';
type SortDir = 'asc' | 'desc';

function sortValue(clip: Clip, key: SortKey): number {
  return key === 'score' ? clip.viralityScore : clip.endTime - clip.startTime;
}

function SortButton({
  label,
  active,
  dir,
  onClick,
}: {
  label: string;
  active: boolean;
  dir: SortDir;
  onClick: () => void;
}) {
  return (
    <Button
      size="sm"
      variant={active ? 'default' : 'outline'}
      onClick={onClick}
      className={cn('gap-1.5', !active && 'text-muted-foreground')}
      aria-pressed={active}
    >
      {label}
      {active ? (
        dir === 'desc' ? (
          <ChevronDown className="h-3.5 w-3.5" aria-hidden="true" />
        ) : (
          <ChevronUp className="h-3.5 w-3.5" aria-hidden="true" />
        )
      ) : null}
    </Button>
  );
}

export function ClipGrid({ videoId, clips }: { videoId: string; clips: Clip[] }) {
  const [sortKey, setSortKey] = useState<SortKey>('score');
  const [sortDir, setSortDir] = useState<SortDir>('desc');

  function handleSort(key: SortKey) {
    if (key === sortKey) {
      setSortDir((d) => (d === 'desc' ? 'asc' : 'desc'));
    } else {
      setSortKey(key);
      setSortDir('desc');
    }
  }

  const sortedClips = useMemo(() => {
    const factor = sortDir === 'desc' ? -1 : 1;
    return [...clips].sort((a, b) => factor * (sortValue(a, sortKey) - sortValue(b, sortKey)));
  }, [clips, sortKey, sortDir]);

  if (clips.length === 0) {
    return <p className="font-body text-sm text-muted-foreground">Tidak ada klip yang ditemukan untuk video ini.</p>;
  }

  return (
    <div>
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-mono text-xs uppercase tracking-wide text-muted-foreground">
          Urutkan
        </span>
        <SortButton
          label="Skor"
          active={sortKey === 'score'}
          dir={sortDir}
          onClick={() => handleSort('score')}
        />
        <SortButton
          label="Durasi"
          active={sortKey === 'duration'}
          dir={sortDir}
          onClick={() => handleSort('duration')}
        />
      </div>

      <div className="mt-6 grid grid-cols-2 gap-4 sm:grid-cols-3">
        {sortedClips.map((clip) => (
          <ClipCard key={clip.id} videoId={videoId} clip={clip} />
        ))}
      </div>
    </div>
  );
}
