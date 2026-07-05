const STEPS = [
  {
    number: '01',
    timecode: 'T+00:03',
    title: 'Transcribe',
    description: 'Whisper mentranskrip seluruh audio dengan timestamp presisi kata-per-kata.',
  },
  {
    number: '02',
    timecode: 'T+00:41',
    title: 'Auto-Clip',
    description: 'AI membaca transkrip, menandai momen paling menarik, dan memberi skor virality 0–100.',
  },
  {
    number: '03',
    timecode: 'T+01:58',
    title: 'Render & Caption',
    description: 'FFmpeg crop ke 9:16 mengikuti wajah, bakar caption otomatis — klip siap diunduh atau dipublish.',
  },
];

export function HowItWorks() {
  return (
    <div>
      <h2 className="font-display text-3xl uppercase tracking-wide text-foreground">Cara Kerja</h2>
      <p className="mt-2 max-w-xl font-body text-muted-foreground">
        Tiga tahap otomatis dari satu file video sampai klip siap posting.
      </p>

      <div className="mt-12 grid gap-8 md:grid-cols-3">
        {STEPS.map((step, i) => (
          <div key={step.number} className="relative">
            <div className="flex items-center gap-3">
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-signal-pink font-mono text-sm text-signal-pink">
                {step.number}
              </span>
              <span className="font-mono text-xs text-signal-cyan">{step.timecode}</span>
            </div>
            <h3 className="mt-4 font-display text-xl uppercase tracking-wide text-foreground">
              {step.title}
            </h3>
            <p className="mt-2 font-body text-sm text-muted-foreground">{step.description}</p>
            {i < STEPS.length - 1 ? (
              <div
                className="absolute right-[-1rem] top-[18px] hidden h-px w-8 bg-border md:block"
                aria-hidden="true"
              />
            ) : null}
          </div>
        ))}
      </div>
    </div>
  );
}
