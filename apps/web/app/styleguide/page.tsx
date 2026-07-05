'use client';

import { useState } from 'react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { LetterboxBand } from '@/components/signature/LetterboxBand';
import { LiveReel, type LiveReelThumbnail } from '@/components/signature/LiveReel';

const COLOR_TOKENS = [
  { name: 'Bay Black', hex: '#0B0E14', className: 'bg-bay-black', textClassName: 'text-paper-white' },
  { name: 'Slate Panel', hex: '#151922', className: 'bg-slate-panel', textClassName: 'text-paper-white' },
  { name: 'Chrome', hex: '#A8B0BE', className: 'bg-chrome', textClassName: 'text-bay-black' },
  { name: 'Signal Pink', hex: '#FF3B7F', className: 'bg-signal-pink', textClassName: 'text-paper-white' },
  { name: 'Signal Cyan', hex: '#22E6D6', className: 'bg-signal-cyan', textClassName: 'text-bay-black' },
  { name: 'Paper White', hex: '#EDEFF2', className: 'bg-paper-white', textClassName: 'text-bay-black' },
];

function placeholderThumb(index: number, tone: string): string {
  const svg = `<svg xmlns='http://www.w3.org/2000/svg' width='200' height='356'><rect width='200' height='356' fill='${tone}'/><text x='50%' y='50%' font-family='monospace' font-size='28' fill='white' text-anchor='middle' dominant-baseline='middle'>#${index}</text></svg>`;
  return `data:image/svg+xml,${encodeURIComponent(svg)}`;
}

const DEMO_THUMBNAILS: LiveReelThumbnail[] = [
  { id: '1', src: placeholderThumb(1, '#1a2233'), alt: 'Clip 1' },
  { id: '2', src: placeholderThumb(2, '#241a33'), alt: 'Clip 2' },
  { id: '3', src: placeholderThumb(3, '#331a26'), alt: 'Clip 3' },
  { id: '4', src: placeholderThumb(4, '#1a3330'), alt: 'Clip 4' },
  { id: '5', src: placeholderThumb(5, '#332a1a'), alt: 'Clip 5' },
];

function Section({
  title,
  description,
  children,
}: {
  title: string;
  description?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="py-16">
      <LetterboxBand />
      <div className="mx-auto max-w-6xl px-6 py-10">
        <h2 className="font-display text-2xl uppercase tracking-wide text-foreground">{title}</h2>
        {description ? <p className="mt-2 max-w-2xl text-muted-foreground">{description}</p> : null}
        <div className="mt-8">{children}</div>
      </div>
    </section>
  );
}

export default function StyleguidePage() {
  const [progress, setProgress] = useState(42);
  const [selectedThumb, setSelectedThumb] = useState('2');
  const [seekTime, setSeekTime] = useState(18);

  return (
    <main className="min-h-screen bg-background">
      <div className="mx-auto max-w-6xl px-6 pt-16">
        <Badge variant="outline">internal / not for production</Badge>
        <h1 className="mt-4 font-display text-5xl uppercase tracking-wide text-foreground">
          Styleguide
        </h1>
        <p className="mt-3 max-w-2xl text-muted-foreground">
          Fase 0 foundation review — color tokens, type scale, and the signature Letterbox
          Band / Live Reel components before any real page gets built on top of them.
        </p>
      </div>

      <Section
        title="Color Tokens"
        description="Named Tailwind colors — bay-black, slate-panel, chrome, signal-pink, signal-cyan, paper-white."
      >
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-6">
          {COLOR_TOKENS.map((token) => (
            <div key={token.name} className="overflow-hidden rounded-lg border border-border">
              <div className={`flex h-24 items-end p-3 ${token.className} ${token.textClassName}`}>
                <span className="font-mono text-xs">{token.hex}</span>
              </div>
              <div className="bg-card p-3">
                <p className="font-body text-sm text-foreground">{token.name}</p>
              </div>
            </div>
          ))}
        </div>
      </Section>

      <Section
        title="Typography"
        description="Three distinct roles — Oswald for display, Manrope for body, IBM Plex Mono reserved for timecode/stats/numbers."
      >
        <div className="space-y-8">
          <div>
            <Badge variant="muted" className="mb-3">
              Display — Oswald
            </Badge>
            <p className="font-display text-6xl uppercase tracking-wide text-foreground">
              Auto-Clip Your Video
            </p>
            <p className="font-display text-3xl uppercase tracking-wide text-chrome">
              Section headline
            </p>
          </div>
          <div>
            <Badge variant="muted" className="mb-3">
              Body — Manrope
            </Badge>
            <p className="max-w-2xl font-body text-base text-foreground">
              Upload a long-form video and get short, caption-burned clips ranked by virality
              score — ready to publish to YouTube Shorts, TikTok, and Instagram Reels.
            </p>
            <p className="mt-2 max-w-2xl font-body text-sm text-muted-foreground">
              Secondary body copy uses Chrome for reduced emphasis.
            </p>
          </div>
          <div>
            <Badge variant="muted" className="mb-3">
              Mono / Utility — IBM Plex Mono
            </Badge>
            <div className="flex flex-wrap items-baseline gap-6">
              <span className="font-mono text-3xl text-signal-cyan">00:03:41</span>
              <span className="font-mono text-3xl text-signal-pink">92</span>
              <span className="font-mono text-sm text-chrome">virality score</span>
              <span className="font-mono text-sm text-chrome">#growth #hooks #reel</span>
            </div>
          </div>
        </div>
      </Section>

      <Section title="Base Components" description="shadcn primitives restyled onto the token system.">
        <div className="grid gap-8 md:grid-cols-2">
          <div className="flex flex-wrap items-center gap-3">
            <Button>Primary CTA</Button>
            <Button variant="secondary">Secondary</Button>
            <Button variant="outline">Outline</Button>
            <Button variant="ghost">Ghost</Button>
            <Button variant="destructive">Destructive</Button>
          </div>
          <div className="max-w-sm space-y-3">
            <Label htmlFor="demo-input">Email</Label>
            <Input id="demo-input" placeholder="you@example.com" />
          </div>
          <Card className="max-w-sm">
            <CardHeader>
              <CardTitle>Clip Candidate</CardTitle>
              <CardDescription>Auto-detected moment, ready to review.</CardDescription>
            </CardHeader>
            <CardContent className="flex items-center gap-3">
              <Badge>Score 92</Badge>
              <Badge variant="secondary">0:38</Badge>
            </CardContent>
          </Card>
        </div>
      </Section>

      <Section
        title="Letterbox Band"
        description="Thin horizontal line marking a major section boundary — used above/below, not sprinkled everywhere."
      >
        <div className="space-y-6">
          <div>
            <p className="mb-2 font-mono text-xs text-muted-foreground">tone=&quot;default&quot;</p>
            <LetterboxBand />
          </div>
          <div>
            <p className="mb-2 font-mono text-xs text-muted-foreground">tone=&quot;accent&quot;</p>
            <LetterboxBand tone="accent" />
          </div>
        </div>
      </Section>

      <Section
        title="Live Reel — idle"
        description="Hero background texture. Decorative filmstrip + waveform drift, paused under prefers-reduced-motion."
      >
        <div className="rounded-lg border border-border bg-slate-panel p-6">
          <LiveReel variant="idle" />
        </div>
      </Section>

      <Section
        title="Live Reel — progress"
        description="Processing screen. Bars fill to a real progress value — no fake looping animation."
      >
        <div className="space-y-4">
          <LiveReel variant="progress" progress={progress} label="Detecting viral moments" />
          <div className="flex items-center gap-3">
            <Button size="sm" variant="outline" onClick={() => setProgress((p) => Math.max(0, p - 10))}>
              -10
            </Button>
            <Button size="sm" variant="outline" onClick={() => setProgress((p) => Math.min(100, p + 10))}>
              +10
            </Button>
            <span className="font-mono text-xs text-muted-foreground">
              simulates a WebSocket/SSE progress update
            </span>
          </div>
        </div>
      </Section>

      <Section title="Live Reel — thumbnail-strip" description="Clip gallery filmstrip of rendered clips.">
        <LiveReel
          variant="thumbnail-strip"
          thumbnails={DEMO_THUMBNAILS}
          selectedId={selectedThumb}
          onSelect={setSelectedThumb}
        />
      </Section>

      <Section title="Live Reel — ruler" description="Timeline editor ruler with playhead and click-to-seek.">
        <LiveReel variant="ruler" durationSeconds={90} currentTime={seekTime} onSeek={setSeekTime} />
      </Section>

      <div className="py-16">
        <LetterboxBand />
      </div>
    </main>
  );
}
