import OpenAI from 'openai';

// Groq exposes an OpenAI-API-compatible endpoint, including for audio
// transcription (POST /audio/transcriptions, same request/response shape as
// OpenAI's own Whisper endpoint) - so the same `openai` SDK works against it
// unmodified, just pointed at a different baseURL with a Groq API key. This
// is the free/default transcription provider (see
// packages/shared/src/types/video.ts's TranscriptionProvider) - OpenAI
// Whisper itself is the paid "premium" tier (../openai.ts).
export const groq = new OpenAI({
  apiKey: process.env.GROQ_API_KEY,
  baseURL: 'https://api.groq.com/openai/v1',
});

// Groq's fast Whisper model - the whole reason it's the default: noticeably
// cheaper/faster than OpenAI's whisper-1 for the same transcription quality
// tier, which is why it can be free-by-default while OpenAI Whisper is
// pay-per-use.
export const GROQ_WHISPER_MODEL = 'whisper-large-v3-turbo';
