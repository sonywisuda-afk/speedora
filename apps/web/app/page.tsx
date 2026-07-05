import { ClosingCta } from '@/components/marketing/ClosingCta';
import { Hero } from '@/components/marketing/Hero';
import { HowItWorks } from '@/components/marketing/HowItWorks';
import { SocialProof } from '@/components/marketing/SocialProof';
import { LetterboxBand } from '@/components/signature/LetterboxBand';

export default function MarketingPage() {
  return (
    <main className="min-h-screen bg-background">
      <LetterboxBand tone="accent" />
      <section className="mx-auto max-w-6xl px-6 py-20">
        <Hero />
      </section>

      <LetterboxBand />
      <section className="mx-auto max-w-6xl px-6 py-20">
        <HowItWorks />
      </section>

      <LetterboxBand />
      <section className="mx-auto max-w-6xl px-6 py-20">
        <SocialProof />
      </section>

      <LetterboxBand />
      <section className="mx-auto max-w-6xl px-6 py-20">
        <ClosingCta />
      </section>
      <LetterboxBand tone="accent" />
    </main>
  );
}
