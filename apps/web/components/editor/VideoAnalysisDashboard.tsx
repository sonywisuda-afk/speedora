'use client';

import type { ClipScores } from '@speedora/shared';

import { ScoreGauge } from '@/components/ScoreGauge';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { useTimelineStore, type TimelineClip } from '@/lib/timelineStore';

// Same labels as TimelineEditor.tsx's per-clip breakdown panel - kept as a
// separate copy rather than extracted (2 occurrences, not the 3rd
// duplication this project's convention extracts at).
const SCORE_LABELS: Record<keyof ClipScores, string> = {
  hookStrength: 'Hook Strength',
  educationalValue: 'Educational Value',
  curiosity: 'Curiosity',
  emotion: 'Emotion',
  storytelling: 'Storytelling',
  novelty: 'Novelty',
  trustAuthority: 'Trust/Authority',
};

const INTENT_LABELS: Record<string, string> = {
  educate: 'Edukasi',
  entertain: 'Hiburan',
  persuade: 'Persuasi',
  inspire: 'Inspirasi',
  story: 'Cerita',
  other: 'Lainnya',
};

// A clip in this range hits the length short-form platforms typically
// report the best completion rates for - narrower than the hard 20-90s
// bounds detect-clips.worker.ts already enforces on every candidate (see
// MIN_CLIP_SECONDS/MAX_CLIP_SECONDS there), so this is a "sweet spot"
// indicator layered on top, not a validity check every clip already passes.
const OPTIMAL_DURATION_SECONDS = { min: 30, max: 60 };

function formatDuration(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.round(seconds % 60);
  return `${m}:${String(s).padStart(2, '0')}`;
}

// Averages each of the 7 metrics across every clip that has a scores
// breakdown at all - a clip can lack one (see ClipScores' nullability, same
// reasoning as hookText) without excluding it from ranking/heatmap, just
// from this particular average.
function averageScores(clips: TimelineClip[]): ClipScores | null {
  const withScores = clips.filter(
    (clip): clip is TimelineClip & { scores: ClipScores } => clip.scores !== null,
  );
  if (withScores.length === 0) return null;

  const keys = Object.keys(SCORE_LABELS) as Array<keyof ClipScores>;
  const result = {} as ClipScores;
  for (const key of keys) {
    result[key] = withScores.reduce((sum, clip) => sum + clip.scores[key], 0) / withScores.length;
  }
  return result;
}

function countBy(values: string[]): Array<[string, number]> {
  const counts = new Map<string, number>();
  for (const value of values) {
    counts.set(value, (counts.get(value) ?? 0) + 1);
  }
  return Array.from(counts.entries()).sort((a, b) => b[1] - a[1]);
}

// Cross-clip view of one video's whole set of detected clips - heatmap of
// where they sit in the source, a virality ranking, average score
// breakdown, and topic/intent distribution. Deliberately built entirely
// from data detect-clips.worker.ts already computed per clip (Fase 8) -
// there's no continuous per-second scoring of the untouched parts of the
// video, so the heatmap only ever highlights the regions that became real
// clips, at the intensity their own viralityScore earned. Read-only, same
// as the per-clip Fase 8 panel this complements.
export function VideoAnalysisDashboard() {
  const clips = useTimelineStore((s) => s.clips);
  const duration = useTimelineStore((s) => s.duration);
  const selectClip = useTimelineStore((s) => s.selectClip);

  if (clips.length === 0) {
    return null;
  }

  const ranked = [...clips].sort((a, b) => b.viralityScore - a.viralityScore);
  const avgScores = averageScores(clips);
  const topicCounts = countBy(clips.flatMap((clip) => clip.topics));
  const intentCounts = countBy(
    clips.map((clip) => clip.intent).filter((intent): intent is string => intent !== null),
  );

  return (
    <Card className="mt-3">
      <CardHeader>
        <CardTitle className="text-base">Ringkasan Analisis</CardTitle>
      </CardHeader>
      <CardContent className="space-y-6">
        {duration > 0 ? (
          <div>
            <p className="font-mono text-[10px] uppercase tracking-wide text-muted-foreground">
              Heatmap Klip di Sepanjang Video
            </p>
            <div className="relative mt-2 h-8 w-full overflow-hidden rounded-sm bg-slate-panel">
              {clips.map((clip) => {
                const left = (clip.startTime / duration) * 100;
                const width = ((clip.endTime - clip.startTime) / duration) * 100;
                // 0.25-0.90 opacity range - even a low-scoring clip stays
                // faintly visible on the timeline rather than disappearing,
                // since "a clip exists here at all" is itself information.
                const intensity = 0.25 + (clip.viralityScore / 100) * 0.65;
                return (
                  <button
                    key={clip.id}
                    type="button"
                    onClick={() => selectClip(clip.id)}
                    className="absolute inset-y-0 transition-opacity hover:opacity-80"
                    style={{
                      left: `${left}%`,
                      width: `${Math.max(width, 0.5)}%`,
                      backgroundColor: `rgba(255, 59, 127, ${intensity})`,
                    }}
                    title={`Skor ${Math.round(clip.viralityScore)}${clip.hookText ? ` — ${clip.hookText}` : ''}`}
                    aria-label={`Pilih klip dengan skor ${Math.round(clip.viralityScore)}`}
                  />
                );
              })}
            </div>
          </div>
        ) : null}

        <div>
          <p className="font-mono text-[10px] uppercase tracking-wide text-muted-foreground">
            Peringkat Klip Terbaik
          </p>
          <div className="mt-2 space-y-2">
            {ranked.map((clip, index) => {
              const clipDuration = clip.endTime - clip.startTime;
              const isOptimalDuration =
                clipDuration >= OPTIMAL_DURATION_SECONDS.min &&
                clipDuration <= OPTIMAL_DURATION_SECONDS.max;
              return (
                <button
                  key={clip.id}
                  type="button"
                  onClick={() => selectClip(clip.id)}
                  className="flex w-full items-center gap-3 rounded-md border border-border bg-slate-panel p-2 text-left transition-colors hover:border-signal-pink/50"
                >
                  <span className="w-6 shrink-0 font-display text-lg text-chrome">
                    #{index + 1}
                  </span>
                  <ScoreGauge score={clip.viralityScore} size={36} />
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-body text-sm text-foreground">
                      {clip.hookText || `Klip mulai ${formatDuration(clip.startTime)}`}
                    </p>
                    <p className="font-mono text-xs text-muted-foreground">
                      {formatDuration(clipDuration)}
                      {isOptimalDuration ? (
                        <span className="ml-2 text-signal-cyan">Durasi optimal</span>
                      ) : null}
                    </p>
                  </div>
                </button>
              );
            })}
          </div>
        </div>

        {avgScores ? (
          <div>
            <p className="font-mono text-[10px] uppercase tracking-wide text-muted-foreground">
              Rata-rata Skor Lintas Klip
            </p>
            <div className="mt-2 space-y-1.5">
              {(Object.keys(SCORE_LABELS) as Array<keyof ClipScores>).map((key) => (
                <div key={key} className="flex items-center gap-2">
                  <span className="w-32 shrink-0 font-mono text-[10px] text-muted-foreground">
                    {SCORE_LABELS[key]}
                  </span>
                  <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-slate-panel">
                    <div
                      className="h-full rounded-full bg-signal-cyan"
                      style={{ width: `${avgScores[key]}%` }}
                    />
                  </div>
                  <span className="w-8 shrink-0 text-right font-mono text-[10px] text-signal-cyan">
                    {Math.round(avgScores[key])}
                  </span>
                </div>
              ))}
            </div>
          </div>
        ) : null}

        {topicCounts.length > 0 || intentCounts.length > 0 ? (
          <div className="grid gap-4 sm:grid-cols-2">
            {topicCounts.length > 0 ? (
              <div>
                <p className="font-mono text-[10px] uppercase tracking-wide text-muted-foreground">
                  Distribusi Topik
                </p>
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {topicCounts.map(([topic, count]) => (
                    <Badge key={topic} variant="outline">
                      {topic}
                      {count > 1 ? ` ×${count}` : ''}
                    </Badge>
                  ))}
                </div>
              </div>
            ) : null}

            {intentCounts.length > 0 ? (
              <div>
                <p className="font-mono text-[10px] uppercase tracking-wide text-muted-foreground">
                  Distribusi Intent
                </p>
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {intentCounts.map(([intent, count]) => (
                    <Badge key={intent} variant="muted">
                      {INTENT_LABELS[intent] ?? intent}
                      {count > 1 ? ` ×${count}` : ''}
                    </Badge>
                  ))}
                </div>
              </div>
            ) : null}
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}
