'use client';

import { useEffect, useRef, useState } from 'react';
import { loadTurnstile } from '@/lib/turnstile';

// Authentication Foundation Sprint 4 (Attack Protection) - rendered only
// once a login attempt has come back with requiresCaptcha:true (see
// upload/page.tsx's handleAuthSubmit). Renders Cloudflare's real widget
// into containerRef once the script loads, and reports the solved token up
// via onToken.
export function TurnstileWidget({ onToken }: { onToken: (token: string) => void }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let widgetId: string | null = null;
    let cancelled = false;

    loadTurnstile()
      .then((turnstile) => {
        if (cancelled || !containerRef.current) return;
        const siteKey = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY;
        if (!siteKey) {
          setError('Verifikasi tidak tersedia saat ini.');
          return;
        }
        widgetId = turnstile.render(containerRef.current, {
          sitekey: siteKey,
          callback: onToken,
          'error-callback': () => setError('Verifikasi gagal. Coba lagi.'),
        });
      })
      .catch(() => setError('Gagal memuat verifikasi. Coba lagi.'));

    return () => {
      cancelled = true;
      if (widgetId && window.turnstile) window.turnstile.remove(widgetId);
    };
    // onToken is a stable setter from the parent's useState - only mount
    // once per render of this widget, same reasoning as other lazy-widget
    // effects in this codebase.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="space-y-2">
      <div ref={containerRef} />
      {error ? <p className="text-sm text-destructive">{error}</p> : null}
    </div>
  );
}
