'use client';

import type { TranscriptSegment } from '@speedora/shared';
import { suggestEmojis } from '@speedora/emoji-suggester';
import { useMemo, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useTimelineStore } from '@/lib/timelineStore';

function formatTime(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
}

// Subtitle Studio roadmap (P2d) - suggestEmojis is a pure, dependency-free
// function (no Node-only APIs, see @speedora/emoji-suggester's own
// comment), so this calls it directly client-side per segment rather than
// a new API round trip - the same package apps/worker's detect-clips job
// already calls once per clip, just at a different granularity here.
function EmojiSuggestions({ text, onInsert }: { text: string; onInsert: (emoji: string) => void }) {
  const { emojis } = useMemo(() => suggestEmojis({ text }), [text]);
  if (emojis.length === 0) return null;
  return (
    <div className="mt-1 flex gap-1">
      {emojis.map((emoji, i) => (
        <button
          key={`${emoji}-${i}`}
          type="button"
          onClick={() => onInsert(emoji)}
          title="Sisipkan emoji"
          className="rounded px-1.5 py-0.5 text-sm hover:bg-slate-panel"
        >
          {emoji}
        </button>
      ))}
    </div>
  );
}

function SegmentRow({
  videoId,
  segment,
  nextSegment,
}: {
  videoId: string;
  segment: TranscriptSegment;
  nextSegment: TranscriptSegment | undefined;
}) {
  const [text, setText] = useState(segment.text);
  // Resyncs local text when segment.text changes for a reason OTHER than
  // this row's own edit (merge/split changing this row's underlying text,
  // or a sibling row's merge/split shifting which segment this key now
  // refers to) - React's own "adjusting state when a prop changes" pattern
  // (calling setState during render, guarded), since this row isn't
  // remounted (same segment.id) when its content changes externally.
  const [lastSyncedText, setLastSyncedText] = useState(segment.text);
  if (segment.text !== lastSyncedText) {
    setLastSyncedText(segment.text);
    setText(segment.text);
  }

  const [splitAt, setSplitAt] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);
  const updateSegmentText = useTimelineStore((s) => s.updateSegmentText);
  const mergeSegments = useTimelineStore((s) => s.mergeSegments);
  const splitSegment = useTimelineStore((s) => s.splitSegment);

  const dirty = text !== segment.text;
  const words = segment.words;

  async function handleSave() {
    if (!segment.id || !dirty) return;
    setSaving(true);
    try {
      await updateSegmentText(videoId, segment.id, text);
    } finally {
      setSaving(false);
    }
  }

  async function handleMerge() {
    if (!segment.id || !nextSegment?.id) return;
    setSaving(true);
    try {
      await mergeSegments(videoId, segment.id, nextSegment.id);
    } finally {
      setSaving(false);
    }
  }

  async function handleSplit() {
    if (!segment.id || splitAt === null) return;
    setSaving(true);
    try {
      await splitSegment(videoId, segment.id, splitAt);
      setSplitAt(null);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="rounded-md border border-border p-3">
      <div className="flex items-center justify-between">
        <span className="font-mono text-xs text-muted-foreground">
          {formatTime(segment.start)} – {formatTime(segment.end)}
          {segment.speaker ? ` · ${segment.speaker}` : ''}
        </span>
        <div className="flex gap-2">
          {dirty && (
            <Button size="sm" variant="outline" disabled={saving} onClick={handleSave}>
              Simpan
            </Button>
          )}
          {nextSegment && (
            <Button size="sm" variant="outline" disabled={saving} onClick={handleMerge}>
              Gabung dengan berikutnya
            </Button>
          )}
        </div>
      </div>

      <Input
        value={text}
        onChange={(e) => setText(e.target.value)}
        className="mt-2 h-9"
        autoComplete="off"
      />

      <EmojiSuggestions text={text} onInsert={(emoji) => setText((t) => `${t} ${emoji}`)} />

      {/* Split - word-index picker if word-level timing exists, otherwise a
          plain word-count picker feeding the same approximate fallback the
          backend already handles (VideosService.splitTranscriptSegment). */}
      {(words?.length ?? text.trim().split(/\s+/).length) > 1 && (
        <div className="mt-2 flex items-center gap-2">
          <select
            value={splitAt ?? ''}
            onChange={(e) => setSplitAt(e.target.value ? Number(e.target.value) : null)}
            className="h-8 rounded-md border border-input bg-slate-panel px-2 font-mono text-xs text-foreground"
          >
            <option value="">Pisah sebelum kata...</option>
            {(words?.map((w) => w.word) ?? text.trim().split(/\s+/)).map((word, i) =>
              i === 0 ? null : (
                <option key={i} value={i}>
                  {i}. &quot;{word}&quot;
                </option>
              ),
            )}
          </select>
          <Button size="sm" variant="outline" disabled={saving || splitAt === null} onClick={handleSplit}>
            Pisah
          </Button>
        </div>
      )}
    </div>
  );
}

// Subtitle Studio roadmap (P2) - a dedicated editing surface, added as a
// 5th mode tab on ReviewModePage (/videos/[id]/review) - not overloading
// TranscriptReviewPanel (explicitly read-only by design) or TimelineEditor's
// compact strip (too small for rich per-segment editing).
export function SubtitleStudioPanel({ videoId }: { videoId: string }) {
  const transcript = useTimelineStore((s) => s.transcript);
  const transcriptError = useTimelineStore((s) => s.transcriptError);
  const requestTranslation = useTimelineStore((s) => s.requestTranslation);
  const [languageCode, setLanguageCode] = useState('');
  const [requesting, setRequesting] = useState(false);
  const [requested, setRequested] = useState<string | null>(null);

  async function handleTranslate() {
    if (!languageCode.trim()) return;
    setRequesting(true);
    setRequested(null);
    try {
      await requestTranslation(videoId, languageCode.trim());
      setRequested(languageCode.trim());
    } finally {
      setRequesting(false);
    }
  }

  return (
    <div className="space-y-4">
      <div className="rounded-md border border-border bg-slate-panel p-3">
        <p className="font-mono text-xs uppercase tracking-wide text-muted-foreground">
          Terjemahkan Transkrip
        </p>
        <div className="mt-2 flex items-center gap-2">
          <Input
            value={languageCode}
            onChange={(e) => setLanguageCode(e.target.value)}
            placeholder="mis. en, id, es..."
            className="h-9 w-40"
            autoComplete="off"
          />
          <Button size="sm" disabled={requesting || !languageCode.trim()} onClick={handleTranslate}>
            {requesting ? 'Mengirim...' : 'Terjemahkan'}
          </Button>
        </div>
        {requested && (
          <p className="mt-2 font-body text-xs text-muted-foreground">
            Permintaan terjemahan ke &quot;{requested}&quot; terkirim - muat ulang transkrip
            beberapa saat lagi untuk melihat hasilnya, lalu pilih bahasa ini di panel Timeline
            Editor untuk membakarnya ke render.
          </p>
        )}
        {transcriptError && (
          <p className="mt-2 font-body text-xs text-destructive">{transcriptError}</p>
        )}
      </div>

      <div className="space-y-2">
        {transcript.map((segment, i) => (
          <SegmentRow
            key={segment.id ?? `${segment.start}-${segment.end}`}
            videoId={videoId}
            segment={segment}
            nextSegment={transcript[i + 1]}
          />
        ))}
        {transcript.length === 0 && (
          <p className="font-body text-sm text-muted-foreground">Belum ada transkrip.</p>
        )}
      </div>
    </div>
  );
}
