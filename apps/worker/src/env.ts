// Only variables with no safe fallback are listed here - FFMPEG_PATH
// already defaults to "ffmpeg" (assumed on PATH) in ffmpeg.ts and doesn't
// need to be required. A missing DATABASE_URL/REDIS_URL/GROQ_API_KEY/
// STORAGE_* would otherwise fail confusingly deep inside a connection
// attempt or API call instead of failing loudly at boot.
//
// GROQ_API_KEY (not OPENAI_API_KEY) is the one required transcription key -
// Groq Whisper large-v3-turbo is the free default every video uses unless
// the user pays for premium (see CLAUDE.md's Premium Transcription section
// and transcribe.worker.ts's resolveWhisperClient). OPENAI_API_KEY is
// deliberately NOT in this list: it's only needed for that paid tier, so a
// worker that hasn't had it configured yet still boots and serves every
// free (Groq) transcription normally - only a premium job fails, clearly,
// at the point it actually needs the key (same reasoning as the OAuth vars
// below).
//
// SENTRY_DSN is deliberately NOT in this list - it's optional (see
// sentry.ts's initSentry()), fine to leave unset in local dev, and
// Sentry.init() with an empty dsn just disables the SDK rather than
// throwing.
//
// HUGGINGFACE_TOKEN is also deliberately NOT in this list (Fase 12 -
// speaker diarization) - it's read directly by
// apps/worker/scripts/diarize_speakers.py (not this Node process), and
// diarization.ts's caller (transcribe.worker.ts) already treats any
// diarization failure - missing token, gated model terms not yet accepted
// on Hugging Face (pyannote/speaker-diarization-community-1 - see
// diarize_speakers.py's comment for why not speaker-diarization-3.1), or
// anything else - as "skip speaker labels for this video", not a job
// failure. A worker with no token configured yet still transcribes/clips/
// renders normally, just without speaker labels.
//
// PEXELS_API_KEY/PIXABAY_API_KEY/UNSPLASH_ACCESS_KEY are also deliberately
// NOT in this list (Fase 15 - Auto B-roll, extended to a multi-provider
// Adapter-pattern system in Fase 16) - each provider adapter
// (PexelsAdapter/PixabayAdapter/UnsplashAdapter, see
// apps/worker/src/assets/) checks its own key and returns null (that
// provider has nothing to offer) rather than making a doomed request when
// it's unset, and StockAssetService's tiered fallback simply moves on to
// the next configured provider. A worker with NONE of the three keys
// configured still renders every clip normally, just without B-roll
// cutaways; a worker with only one or two configured still gets B-roll
// from whichever it has.
//
// GOOGLE_OAUTH_CLIENT_ID/GOOGLE_OAUTH_CLIENT_SECRET/TIKTOK_CLIENT_KEY/
// TIKTOK_CLIENT_SECRET/FACEBOOK_APP_ID/FACEBOOK_APP_SECRET/
// TOKEN_ENCRYPTION_KEY/API_BASE_URL (Fase 6b/6d) are also read by
// publish-clip.worker.ts via @speedora/social's YouTubeOAuthClient/
// TikTokOAuthClient/InstagramOAuthClient/resolveAccessToken/
// token-encryption - same optional-at-boot treatment as apps/api (see
// CLAUDE.md's Fase 6a/6b/6d sections): a publish-clip job just fails (and
// gets reported to Sentry like any other job error) if the relevant
// platform's credentials are unset, rather than the whole worker refusing
// to start for everyone who hasn't set up Google Cloud OAuth, a TikTok
// Developer app, or a Meta app yet.
const REQUIRED_ENV_VARS = [
  'DATABASE_URL',
  'REDIS_URL',
  'GROQ_API_KEY',
  'STORAGE_ENDPOINT',
  'STORAGE_REGION',
  'STORAGE_BUCKET',
  'STORAGE_ACCESS_KEY_ID',
  'STORAGE_SECRET_ACCESS_KEY',
] as const;

export function validateEnv(env: NodeJS.ProcessEnv = process.env): void {
  const missing = REQUIRED_ENV_VARS.filter((key) => !env[key]);

  if (missing.length > 0) {
    throw new Error(
      `Missing required environment variable(s): ${missing.join(', ')}. Check .env against .env.example.`,
    );
  }
}
