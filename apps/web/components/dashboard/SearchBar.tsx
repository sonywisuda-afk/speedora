'use client';

import type { SearchResultsDto } from '@speedora/shared';
import { Search } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Input } from '@/components/ui/input';
import { search as searchApi } from '@/lib/api';
import {
  formatTranscriptSnippet,
  formatTranscriptTimestamp,
  hasAnyResults,
} from '@/lib/search';

const DEBOUNCE_MS = 300;

// Cross-entity search (video/clip/keyword/transcript) - debounced so every
// keystroke doesn't fire a request. Results link to the matching video's
// existing detail block below (anchored #video-<id>, same convention as
// RecentProjectsGrid) rather than a separate search results page.
export function SearchBar() {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<SearchResultsDto | null>(null);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const trimmed = query.trim();
    if (trimmed.length === 0) {
      setResults(null);
      return;
    }

    let cancelled = false;
    const timer = setTimeout(() => {
      searchApi(trimmed)
        .then((res) => {
          if (!cancelled) setResults(res);
        })
        .catch(() => {
          if (!cancelled) setResults(null);
        });
    }, DEBOUNCE_MS);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [query]);

  return (
    <div className="relative">
      <div className="relative">
        <Search
          className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
          aria-hidden="true"
        />
        <Input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onFocus={() => setOpen(true)}
          onBlur={() => setTimeout(() => setOpen(false), 150)}
          placeholder="Cari video, klip, kata kunci, atau transkrip..."
          className="pl-9"
          // A live filter box, not a form field meant to be filled with a
          // saved value - same autoComplete="off" convention as
          // app/accounts/page.tsx's delete-confirmation input. Also stops
          // the browser's own autofill/heuristic-highlighting pass on this
          // input, which was the actual source of an intermittent "Extra
          // attributes from the server: style" hydration warning (confirmed
          // via a MutationObserver + repeated headless-Chromium runs: no
          // style attribute was ever present in this app's own rendered
          // output, and the warning wasn't reproducible on every run - a
          // real server/client markup mismatch would be deterministic).
          autoComplete="off"
          autoCorrect="off"
          autoCapitalize="off"
          spellCheck={false}
        />
      </div>

      {open && results && (
        <div className="absolute z-10 mt-1 w-full rounded-md border border-border bg-card p-2 shadow-lg">
          {!hasAnyResults(results) ? (
            <p className="p-2 font-body text-sm text-muted-foreground">Tidak ada hasil.</p>
          ) : (
            <div className="max-h-96 space-y-3 overflow-y-auto">
              {results.videos.length > 0 && (
                <div>
                  <p className="px-2 font-mono text-[10px] uppercase text-muted-foreground">
                    Video
                  </p>
                  {results.videos.map((video) => (
                    <a
                      key={video.videoId}
                      href={`#video-${video.videoId}`}
                      className="block rounded px-2 py-1.5 font-body text-sm text-foreground hover:bg-accent"
                    >
                      {video.title ?? 'Video Tanpa Judul'}
                    </a>
                  ))}
                </div>
              )}
              {results.clips.length > 0 && (
                <div>
                  <p className="px-2 font-mono text-[10px] uppercase text-muted-foreground">
                    Klip
                  </p>
                  {results.clips.map((clip) => (
                    <a
                      key={clip.clipId}
                      href={`#video-${clip.videoId}`}
                      className="block rounded px-2 py-1.5 font-body text-sm text-foreground hover:bg-accent"
                    >
                      {clip.hookText ?? (clip.hashtags.map((tag) => `#${tag}`).join(' ') || 'Klip')}
                    </a>
                  ))}
                </div>
              )}
              {results.transcriptMatches.length > 0 && (
                <div>
                  <p className="px-2 font-mono text-[10px] uppercase text-muted-foreground">
                    Transkrip
                  </p>
                  {results.transcriptMatches.map((match, index) => (
                    <a
                      key={`${match.videoId}-${index}`}
                      href={`#video-${match.videoId}`}
                      className="block rounded px-2 py-1.5 font-body text-sm text-foreground hover:bg-accent"
                    >
                      <span className="mr-2 font-mono text-xs text-chrome">
                        {formatTranscriptTimestamp(match.start)}
                      </span>
                      {formatTranscriptSnippet(match.text, query)}
                    </a>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
