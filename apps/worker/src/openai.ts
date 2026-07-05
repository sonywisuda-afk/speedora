import OpenAI from 'openai';

export const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// The paid "premium" transcription tier (see
// packages/shared/src/types/video.ts's TranscriptionProvider) - gated by a
// PremiumCredit, unlike Groq's free-by-default whisper-large-v3-turbo
// (../groq.ts).
export const OPENAI_WHISPER_MODEL = 'whisper-1';
