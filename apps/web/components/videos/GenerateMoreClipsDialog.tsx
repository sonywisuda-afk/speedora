'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { generateMoreClips } from '@/lib/api';

// "Prioritas kualitas" (Phase C.4) - a simple 3-tier UI over
// ClipScoringInput's existing minConfidence (0-100 viralityScore floor,
// already supported end to end since the Pre-Processing Settings roadmap) -
// not a new scoring concept, just a friendlier control than a raw 0-100
// input for a one-off "generate a few more" request.
const QUALITY_TIERS = {
  any: undefined,
  medium: 40,
  high: 70,
} as const;
type QualityTier = keyof typeof QUALITY_TIERS;

// Generate More Clips roadmap (Phase C) - a self-contained trigger+dialog,
// same "drop straight into a toolbar" shape as ExportCenterDialog on the
// video edit page. Deliberately does NOT touch useTimelineStore after a
// successful submit - that store's load() is a hard reset (playhead,
// selection, and any unsaved dirty trim state all get wiped), which would
// silently discard a user's in-progress edit if this dialog auto-refreshed
// it in the background. New clips instead surface via the existing
// Notification Center (CLIP_READY per clip, GENERATE_MORE_NO_CANDIDATES if
// none were found) - the user reopens/reloads the page to see them, the
// same way any other async pipeline stage already works in this app.
export function GenerateMoreClipsDialog({ videoId }: { videoId: string }) {
  const [open, setOpen] = useState(false);
  const [requestedCount, setRequestedCount] = useState(2);
  const [minClipDurationSeconds, setMinClipDurationSeconds] = useState('');
  const [maxClipDurationSeconds, setMaxClipDurationSeconds] = useState('');
  const [avoidOverlap, setAvoidOverlap] = useState(true);
  const [qualityTier, setQualityTier] = useState<QualityTier>('any');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submitted, setSubmitted] = useState(false);

  function handleOpenChange(next: boolean) {
    setOpen(next);
    if (!next) {
      // Reset only on close, not mid-dialog - a failed submit should let the
      // user retry without re-entering every field.
      setSubmitting(false);
      setError(null);
      setSubmitted(false);
    }
  }

  async function handleSubmit() {
    setSubmitting(true);
    setError(null);
    try {
      await generateMoreClips(videoId, {
        requestedCount,
        minClipDurationSeconds: minClipDurationSeconds ? Number(minClipDurationSeconds) : undefined,
        maxClipDurationSeconds: maxClipDurationSeconds ? Number(maxClipDurationSeconds) : undefined,
        minConfidence: QUALITY_TIERS[qualityTier],
        avoidOverlap,
      });
      setSubmitted(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Gagal membuat klip tambahan');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger asChild>
        <Button variant="outline">Generate More Clips</Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Generate More Clips</DialogTitle>
        </DialogHeader>

        {submitted ? (
          <div className="space-y-4">
            <p className="font-body text-sm text-muted-foreground">
              Klip tambahan sedang diproses. Kamu akan menerima notifikasi saat setiap klip siap,
              atau saat tidak ada momen baru yang ditemukan.
            </p>
            <DialogFooter>
              <Button onClick={() => handleOpenChange(false)}>Tutup</Button>
            </DialogFooter>
          </div>
        ) : (
          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="generate-more-count">Jumlah klip tambahan</Label>
              <Input
                id="generate-more-count"
                type="number"
                min={1}
                max={10}
                value={requestedCount}
                onChange={(e) => setRequestedCount(Number(e.target.value))}
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="generate-more-min-duration">Durasi minimum (detik)</Label>
                <Input
                  id="generate-more-min-duration"
                  type="number"
                  min={5}
                  max={600}
                  placeholder="Default"
                  value={minClipDurationSeconds}
                  onChange={(e) => setMinClipDurationSeconds(e.target.value)}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="generate-more-max-duration">Durasi maksimum (detik)</Label>
                <Input
                  id="generate-more-max-duration"
                  type="number"
                  min={5}
                  max={600}
                  placeholder="Default"
                  value={maxClipDurationSeconds}
                  onChange={(e) => setMaxClipDurationSeconds(e.target.value)}
                />
              </div>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="generate-more-quality">Prioritas kualitas</Label>
              <select
                id="generate-more-quality"
                value={qualityTier}
                onChange={(e) => setQualityTier(e.target.value as QualityTier)}
                className="h-10 w-full rounded-md border border-input bg-background px-3 font-body text-sm text-foreground"
              >
                <option value="any">Semua</option>
                <option value="medium">Sedang</option>
                <option value="high">Tinggi</option>
              </select>
            </div>

            <label className="flex items-center gap-2 font-body text-sm text-foreground">
              <input
                type="checkbox"
                checked={avoidOverlap}
                onChange={(e) => setAvoidOverlap(e.target.checked)}
                className="h-4 w-4 rounded border-input"
              />
              Hindari overlap dengan clip sebelumnya
            </label>

            {error && <p className="font-body text-sm text-destructive">{error}</p>}

            <DialogFooter>
              <Button
                variant="outline"
                onClick={() => handleOpenChange(false)}
                disabled={submitting}
              >
                Cancel
              </Button>
              <Button onClick={handleSubmit} disabled={submitting}>
                {submitting ? 'Memproses...' : 'Generate'}
              </Button>
            </DialogFooter>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
