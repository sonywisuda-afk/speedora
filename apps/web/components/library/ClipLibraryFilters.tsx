'use client';

import { useEffect, useState } from 'react';
import type { ClipLibraryFacetValue, SocialPlatform } from '@speedora/shared';
import { Input } from '@/components/ui/input';
import { DURATION_BUCKETS, EMOTION_LABELS, type DurationBucket } from '@/lib/clip-library';
import { PLATFORM_LABELS } from '@/lib/analytics';
import { cn } from '@/lib/utils';

const KEYWORD_DEBOUNCE_MS = 300;

export interface ClipLibraryFiltersValue {
  platform?: SocialPlatform;
  durationBucket?: DurationBucket;
  emotion?: string;
  topic?: string;
  minScore?: number;
  keyword?: string;
}

export interface ClipLibraryFiltersProps {
  value: ClipLibraryFiltersValue;
  onChange: (value: ClipLibraryFiltersValue) => void;
  topicOptions: ClipLibraryFacetValue[];
}

// AI Clip Library roadmap (P1) - built only from primitives that already
// exist in this app: button-group toggle for the small closed duration set
// (same pattern as DateRangeFilter.tsx), native <select> for the larger
// platform/emotion/topic sets (same pattern as TimezonePicker.tsx) - no
// Select/Combobox UI primitive exists here, and this codebase's own
// convention is not to add one for a closed set.
export function ClipLibraryFilters({ value, onChange, topicOptions }: ClipLibraryFiltersProps) {
  // Local echo so typing feels instant - only the debounced value is
  // reported up, same 300ms debounce convention as SearchBar.tsx.
  const [keywordInput, setKeywordInput] = useState(value.keyword ?? '');

  useEffect(() => {
    setKeywordInput(value.keyword ?? '');
  }, [value.keyword]);

  useEffect(() => {
    const trimmed = keywordInput.trim();
    if (trimmed === (value.keyword ?? '')) return;
    const timer = setTimeout(() => {
      onChange({ ...value, keyword: trimmed || undefined });
    }, KEYWORD_DEBOUNCE_MS);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [keywordInput]);

  return (
    <div className="flex flex-wrap items-end gap-3">
      <div className="flex flex-col gap-1">
        <label
          htmlFor="clip-library-keyword"
          className="font-mono text-[10px] uppercase text-muted-foreground"
        >
          Kata kunci
        </label>
        <Input
          id="clip-library-keyword"
          value={keywordInput}
          onChange={(e) => setKeywordInput(e.target.value)}
          placeholder="Hook, hashtag, topik..."
          className="h-9 w-48"
          autoComplete="off"
        />
      </div>

      <div className="flex flex-col gap-1">
        <span className="font-mono text-[10px] uppercase text-muted-foreground">Durasi</span>
        <div className="flex gap-1">
          <button
            type="button"
            onClick={() => onChange({ ...value, durationBucket: undefined })}
            aria-current={value.durationBucket === undefined ? 'true' : undefined}
            className={cn(
              'rounded-md px-3 py-1.5 font-mono text-xs transition-colors',
              value.durationBucket === undefined
                ? 'bg-primary-surface font-medium text-primary'
                : 'text-muted-foreground hover:bg-accent hover:text-foreground',
            )}
          >
            Semua
          </button>
          {DURATION_BUCKETS.map((bucket) => (
            <button
              key={bucket.label}
              type="button"
              onClick={() => onChange({ ...value, durationBucket: bucket })}
              aria-current={value.durationBucket?.label === bucket.label ? 'true' : undefined}
              className={cn(
                'rounded-md px-3 py-1.5 font-mono text-xs transition-colors',
                value.durationBucket?.label === bucket.label
                  ? 'bg-primary-surface font-medium text-primary'
                  : 'text-muted-foreground hover:bg-accent hover:text-foreground',
              )}
            >
              {bucket.label}
            </button>
          ))}
        </div>
      </div>

      <div className="flex flex-col gap-1">
        <label
          htmlFor="clip-library-platform"
          className="font-mono text-[10px] uppercase text-muted-foreground"
        >
          Platform
        </label>
        <select
          id="clip-library-platform"
          value={value.platform ?? ''}
          onChange={(e) =>
            onChange({
              ...value,
              platform: (e.target.value || undefined) as SocialPlatform | undefined,
            })
          }
          className="h-9 rounded-md border border-input bg-background px-2 font-body text-sm text-foreground"
        >
          <option value="">Semua platform</option>
          {Object.entries(PLATFORM_LABELS).map(([platform, label]) => (
            <option key={platform} value={platform}>
              {label}
            </option>
          ))}
        </select>
      </div>

      <div className="flex flex-col gap-1">
        <label
          htmlFor="clip-library-emotion"
          className="font-mono text-[10px] uppercase text-muted-foreground"
        >
          Emosi
        </label>
        <select
          id="clip-library-emotion"
          value={value.emotion ?? ''}
          onChange={(e) => onChange({ ...value, emotion: e.target.value || undefined })}
          className="h-9 rounded-md border border-input bg-background px-2 font-body text-sm text-foreground"
        >
          <option value="">Semua emosi</option>
          {Object.entries(EMOTION_LABELS).map(([emotion, label]) => (
            <option key={emotion} value={emotion}>
              {label}
            </option>
          ))}
        </select>
      </div>

      <div className="flex flex-col gap-1">
        <label
          htmlFor="clip-library-topic"
          className="font-mono text-[10px] uppercase text-muted-foreground"
        >
          Topik
        </label>
        <select
          id="clip-library-topic"
          value={value.topic ?? ''}
          onChange={(e) => onChange({ ...value, topic: e.target.value || undefined })}
          className="h-9 rounded-md border border-input bg-background px-2 font-body text-sm text-foreground"
          disabled={topicOptions.length === 0}
        >
          <option value="">Semua topik</option>
          {topicOptions.map((topic) => (
            <option key={topic.value} value={topic.value}>
              {topic.value} ({topic.count})
            </option>
          ))}
        </select>
      </div>

      <div className="flex flex-col gap-1">
        <label
          htmlFor="clip-library-min-score"
          className="font-mono text-[10px] uppercase text-muted-foreground"
        >
          Skor minimum
        </label>
        <Input
          id="clip-library-min-score"
          type="number"
          min={0}
          max={100}
          step={5}
          value={value.minScore ?? ''}
          onChange={(e) =>
            onChange({
              ...value,
              minScore: e.target.value === '' ? undefined : Number(e.target.value),
            })
          }
          className="h-9 w-24"
        />
      </div>
    </div>
  );
}
