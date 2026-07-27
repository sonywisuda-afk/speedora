export interface TurnstileRenderOptions {
  sitekey: string;
  callback: (token: string) => void;
  'error-callback'?: () => void;
  theme?: 'light' | 'dark' | 'auto';
}

export interface TurnstileApi {
  render: (container: HTMLElement, options: TurnstileRenderOptions) => string;
  remove: (widgetId: string) => void;
}

declare global {
  interface Window {
    turnstile?: TurnstileApi;
  }
}

const SCRIPT_URL = 'https://challenges.cloudflare.com/turnstile/v0/api.js';

let loadPromise: Promise<TurnstileApi> | null = null;

// Loaded lazily here (not in app/layout.tsx) - same reasoning as
// loadMidtransSnap: only a login attempt that's actually been flagged
// high-risk needs Cloudflare Turnstile's script at all, so every normal
// (low-risk) login never fetches/parses a third-party script.
export function loadTurnstile(): Promise<TurnstileApi> {
  if (loadPromise) return loadPromise;

  loadPromise = new Promise((resolve, reject) => {
    if (window.turnstile) {
      resolve(window.turnstile);
      return;
    }

    const script = document.createElement('script');
    script.src = SCRIPT_URL;
    script.async = true;
    script.defer = true;
    script.onload = () => {
      if (window.turnstile) resolve(window.turnstile);
      else reject(new Error('Turnstile script loaded but window.turnstile is missing'));
    };
    script.onerror = () => reject(new Error('Gagal memuat Cloudflare Turnstile'));
    document.body.appendChild(script);
  });

  return loadPromise;
}
