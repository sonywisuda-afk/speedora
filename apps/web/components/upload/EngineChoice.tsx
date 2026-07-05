'use client';

import { useState } from 'react';
import { Loader2, Sparkles, Zap } from 'lucide-react';
import { PREMIUM_TRANSCRIPTION_PRICE_IDR, TranscriptionProvider } from '@speedora/shared';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { createPremiumCheckout, getPremiumTranscriptionStatus } from '@/lib/api';
import { loadMidtransSnap } from '@/lib/midtransSnap';

const STATUS_POLL_INTERVAL_MS = 2000;
// Generous - covers a buyer who takes their time on Midtrans's own payment
// page before the webhook confirms, not just the confirmation lag itself.
const STATUS_POLL_TIMEOUT_MS = 5 * 60 * 1000;

type Stage = 'select' | 'checking-out' | 'awaiting-confirmation';

const idrFormatter = new Intl.NumberFormat('id-ID', {
  style: 'currency',
  currency: 'IDR',
  maximumFractionDigits: 0,
});

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Shown before ImportTabs/UploadDropzone - the provider choice is made fresh
// here for every upload/import (not a saved account setting), per the
// product decision behind Video.transcriptionProvider (see CLAUDE.md).
export function EngineChoice({ onReady }: { onReady: (provider: TranscriptionProvider) => void }) {
  const [stage, setStage] = useState<Stage>('select');
  const [error, setError] = useState<string | null>(null);

  async function pollForCredit(): Promise<boolean> {
    const deadline = Date.now() + STATUS_POLL_TIMEOUT_MS;
    while (Date.now() < deadline) {
      const { available } = await getPremiumTranscriptionStatus();
      if (available) return true;
      await sleep(STATUS_POLL_INTERVAL_MS);
    }
    return false;
  }

  async function confirmPaymentAndProceed() {
    setStage('awaiting-confirmation');
    const confirmed = await pollForCredit();
    if (confirmed) {
      onReady(TranscriptionProvider.OPENAI);
      return;
    }
    setStage('select');
    setError(
      'Pembayaran diterima tapi konfirmasi belum masuk. Tunggu sebentar lalu coba pilih OpenAI Whisper lagi.',
    );
  }

  async function handleSelectOpenAI() {
    setError(null);

    // Already has an unspent paid credit (e.g. bought one earlier but didn't
    // use it yet) - skip straight to the import step, no need to pay twice.
    const { available } = await getPremiumTranscriptionStatus();
    if (available) {
      onReady(TranscriptionProvider.OPENAI);
      return;
    }

    setStage('checking-out');
    try {
      const [{ snapToken }, snap] = await Promise.all([
        createPremiumCheckout(),
        loadMidtransSnap(),
      ]);

      snap.pay(snapToken, {
        onSuccess: () => void confirmPaymentAndProceed(),
        onPending: () => void confirmPaymentAndProceed(),
        onError: () => {
          setStage('select');
          setError('Pembayaran gagal. Coba lagi.');
        },
        onClose: () => setStage('select'),
      });
    } catch (err) {
      setStage('select');
      setError(err instanceof Error ? err.message : 'Gagal memulai pembayaran. Coba lagi.');
    }
  }

  if (stage === 'checking-out' || stage === 'awaiting-confirmation') {
    return (
      <div className="flex min-h-80 flex-col items-center justify-center rounded-lg border-2 border-dashed border-border bg-slate-panel px-6 py-12 text-center">
        <Loader2 className="h-8 w-8 animate-spin text-chrome" aria-hidden="true" />
        <p className="mt-4 font-body text-sm text-muted-foreground">
          {stage === 'checking-out'
            ? 'Membuka halaman pembayaran...'
            : 'Menunggu konfirmasi pembayaran...'}
        </p>
      </div>
    );
  }

  return (
    <div>
      <h2 className="font-display text-lg uppercase tracking-wide text-foreground">
        Pilih Mesin Transkripsi
      </h2>
      <p className="mt-1 font-body text-sm text-muted-foreground">
        Pilihan ini berlaku untuk video ini saja — kamu bisa pilih ulang setiap kali upload atau
        import.
      </p>

      {error ? <p className="mt-3 text-sm text-destructive">{error}</p> : null}

      <div className="mt-6 grid gap-4 sm:grid-cols-2">
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <CardTitle className="text-base">Groq Whisper V3 Turbo</CardTitle>
              <Badge variant="muted">Default</Badge>
            </div>
            <CardDescription>Transkripsi cepat, gratis untuk setiap video.</CardDescription>
          </CardHeader>
          <CardContent>
            <Button
              className="w-full"
              variant="outline"
              onClick={() => onReady(TranscriptionProvider.GROQ)}
            >
              <Zap className="mr-2 h-4 w-4" aria-hidden="true" />
              Pakai Groq (Gratis)
            </Button>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <CardTitle className="text-base">OpenAI Whisper</CardTitle>
              <Badge>Premium</Badge>
            </div>
            <CardDescription>
              Kualitas transkripsi premium OpenAI —{' '}
              {idrFormatter.format(PREMIUM_TRANSCRIPTION_PRICE_IDR)}
              /video.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Button className="w-full" onClick={() => void handleSelectOpenAI()}>
              <Sparkles className="mr-2 h-4 w-4" aria-hidden="true" />
              Bayar & Pakai OpenAI
            </Button>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
