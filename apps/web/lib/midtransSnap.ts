export interface MidtransSnapResult {
  order_id?: string;
  transaction_status?: string;
  [key: string]: unknown;
}

export interface MidtransSnapCallbacks {
  onSuccess?: (result: MidtransSnapResult) => void;
  onPending?: (result: MidtransSnapResult) => void;
  onError?: (result: MidtransSnapResult) => void;
  onClose?: () => void;
}

export interface MidtransSnap {
  pay: (token: string, callbacks: MidtransSnapCallbacks) => void;
}

declare global {
  interface Window {
    snap?: MidtransSnap;
  }
}

const SNAP_SCRIPT_SANDBOX = 'https://app.sandbox.midtrans.com/snap/snap.js';
const SNAP_SCRIPT_PRODUCTION = 'https://app.midtrans.com/snap/snap.js';

let loadPromise: Promise<MidtransSnap> | null = null;

// Loaded lazily here (not in app/layout.tsx) - only the premium-transcription
// checkout path needs Midtrans's Snap.js at all, so everyone using the free
// GROQ tier never pays for fetching/parsing a third-party script.
export function loadMidtransSnap(): Promise<MidtransSnap> {
  if (loadPromise) return loadPromise;

  loadPromise = new Promise((resolve, reject) => {
    if (window.snap) {
      resolve(window.snap);
      return;
    }

    // The client key (unlike MIDTRANS_SERVER_KEY) is meant to be public -
    // Midtrans's own Snap.js docs have it go straight into a data- attribute
    // on a script tag rendered to the browser. Still optional-at-build so a
    // deploy without Midtrans set up yet fails clearly here rather than
    // shipping a broken script tag.
    const clientKey = process.env.NEXT_PUBLIC_MIDTRANS_CLIENT_KEY;
    if (!clientKey) {
      reject(new Error('NEXT_PUBLIC_MIDTRANS_CLIENT_KEY is not configured'));
      return;
    }

    const isProduction = process.env.NEXT_PUBLIC_MIDTRANS_IS_PRODUCTION === 'true';
    const script = document.createElement('script');
    script.src = isProduction ? SNAP_SCRIPT_PRODUCTION : SNAP_SCRIPT_SANDBOX;
    script.setAttribute('data-client-key', clientKey);
    script.onload = () => {
      if (window.snap) resolve(window.snap);
      else reject(new Error('Midtrans Snap.js loaded but window.snap is missing'));
    };
    script.onerror = () => reject(new Error('Gagal memuat Midtrans Snap.js'));
    document.body.appendChild(script);
  });

  return loadPromise;
}
