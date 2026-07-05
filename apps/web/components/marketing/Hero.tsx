'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { motion, useReducedMotion } from 'framer-motion';

import { Button } from '@/components/ui/button';
import { LiveReel } from '@/components/signature/LiveReel';
import { ScoreGauge } from '@/components/ScoreGauge';

interface DemoClip {
  id: string;
  duration: string;
  score: number;
  hook: string;
  tone: string;
}

const DEMO_CLIPS: DemoClip[] = [
  { id: '1', duration: '0:42', score: 93, hook: '"Ini kesalahan terbesar yang saya buat"', tone: '#1a2233' },
  { id: '2', duration: '0:35', score: 87, hook: 'Momen paling jujur dari sesi ini', tone: '#241a33' },
  { id: '3', duration: '0:51', score: 90, hook: '3 pelajaran dalam 60 detik', tone: '#331a26' },
];

const PROGRESS_DURATION_MS = 1400;

function ClipCard({ clip, index }: { clip: DemoClip; index: number }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 16, scale: 0.94 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      transition={{ duration: 0.4, delay: index * 0.15, ease: 'easeOut' }}
      className="overflow-hidden rounded-md border border-border"
    >
      <div
        className="flex aspect-[9/16] flex-col justify-between p-2"
        style={{ backgroundColor: clip.tone }}
      >
        <span className="self-start rounded-sm bg-bay-black/70 px-1.5 py-0.5 font-mono text-[10px] text-paper-white">
          {clip.duration}
        </span>
        <p className="font-body text-[11px] leading-tight text-paper-white/90">{clip.hook}</p>
      </div>
      <div className="flex items-center justify-center bg-slate-panel py-2">
        <ScoreGauge score={clip.score} size={40} />
      </div>
    </motion.div>
  );
}

function HeroDemo() {
  const prefersReducedMotion = useReducedMotion();
  const [progress, setProgress] = useState(prefersReducedMotion ? 100 : 0);
  const [revealed, setRevealed] = useState(prefersReducedMotion ? true : false);

  useEffect(() => {
    if (prefersReducedMotion) return;

    const start = performance.now();
    let frame: number;

    function tick(now: number) {
      const elapsed = now - start;
      const pct = Math.min(100, (elapsed / PROGRESS_DURATION_MS) * 100);
      setProgress(pct);
      if (pct < 100) {
        frame = requestAnimationFrame(tick);
      } else {
        setRevealed(true);
      }
    }
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [prefersReducedMotion]);

  return (
    <div className="rounded-lg border border-border bg-slate-panel p-6">
      <div className="flex items-center justify-between font-mono text-xs text-muted-foreground">
        <span>source_recording.mp4</span>
        <span>48:12</span>
      </div>

      <div className="mt-4">
        <LiveReel
          variant="progress"
          progress={progress}
          label={progress < 100 ? 'Auto-mendeteksi momen terbaik' : 'Klip siap'}
        />
      </div>

      <div className="mt-6 grid grid-cols-3 gap-3">
        {revealed
          ? DEMO_CLIPS.map((clip, i) => <ClipCard key={clip.id} clip={clip} index={i} />)
          : DEMO_CLIPS.map((clip) => (
              <div
                key={clip.id}
                className="aspect-[9/16] animate-pulse-slow rounded-md border border-border bg-bay-black"
              />
            ))}
      </div>

      <p className="mt-4 font-mono text-[11px] text-muted-foreground">
        Simulasi tampilan — hasil aktual tergantung video kamu.
      </p>
    </div>
  );
}

export function Hero() {
  return (
    <div className="grid gap-10 lg:grid-cols-2 lg:items-center">
      <div>
        <h1 className="font-display text-5xl uppercase leading-[1.05] tracking-wide text-foreground sm:text-6xl">
          Video Panjang Masuk.
          <br />
          Klip Siap Viral Keluar.
        </h1>
        <p className="mt-6 max-w-lg font-body text-lg text-muted-foreground">
          Upload rekaman podcast, webinar, atau live stream kamu. Sistem transkrip
          otomatis, temukan momen paling menarik, lalu render jadi klip vertikal dengan
          caption terbakar-in — siap upload ke TikTok, Reels, atau Shorts.
        </p>
        <div className="mt-8 flex flex-wrap items-center gap-4">
          <Button size="lg" asChild>
            <Link href="/upload">Upload Video Sekarang</Link>
          </Button>
          <p className="font-body text-sm text-muted-foreground">
            Tidak perlu instal apa pun — langsung dari browser.
          </p>
        </div>
      </div>

      <HeroDemo />
    </div>
  );
}
