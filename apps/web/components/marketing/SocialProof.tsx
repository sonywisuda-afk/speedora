import { Badge } from '@/components/ui/badge';
import { ScoreGauge } from '@/components/ScoreGauge';

interface ExampleClip {
  id: string;
  duration: string;
  score: number;
  hook: string;
  hashtags: string[];
  tone: string;
}

const EXAMPLE_CLIPS: ExampleClip[] = [
  {
    id: '1',
    duration: '0:38',
    score: 94,
    hook: 'Kenapa retensi karyawan turun 40% tahun ini',
    hashtags: ['hr', 'startup', 'retensi'],
    tone: '#1a2233',
  },
  {
    id: '2',
    duration: '0:52',
    score: 88,
    hook: '3 kesalahan founder pemula yang bikin runway habis',
    hashtags: ['founder', 'startup', 'funding'],
    tone: '#241a33',
  },
  {
    id: '3',
    duration: '0:45',
    score: 91,
    hook: 'Momen paling jujur dari wawancara ini',
    hashtags: ['podcast', 'interview'],
    tone: '#331a26',
  },
];

export function SocialProof() {
  return (
    <div>
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <h2 className="font-display text-3xl uppercase tracking-wide text-foreground">
          Contoh Hasil Auto-Clip
        </h2>
        <Badge variant="outline">Ilustrasi tampilan, bukan data pengguna nyata</Badge>
      </div>
      <p className="mt-2 max-w-xl font-body text-muted-foreground">
        Begini bentuk output-nya: klip vertikal, hook siap pakai, dan skor virality per klip.
      </p>

      <div className="mt-10 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
        {EXAMPLE_CLIPS.map((clip) => (
          <div key={clip.id} className="overflow-hidden rounded-lg border border-border bg-card">
            <div
              className="flex aspect-[9/16] flex-col justify-between p-4"
              style={{ backgroundColor: clip.tone }}
            >
              <span className="self-start rounded-sm bg-bay-black/70 px-2 py-1 font-mono text-xs text-paper-white">
                {clip.duration}
              </span>
              <p className="font-body text-sm font-medium leading-snug text-paper-white">
                {clip.hook}
              </p>
            </div>
            <div className="flex items-center justify-between gap-3 p-4">
              <div className="flex flex-wrap gap-1.5">
                {clip.hashtags.map((tag) => (
                  <span key={tag} className="font-mono text-xs text-chrome">
                    #{tag}
                  </span>
                ))}
              </div>
              <ScoreGauge score={clip.score} size={48} />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
