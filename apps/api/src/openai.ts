import OpenAI from 'openai';

// Natural Language AI Search roadmap (P4) - the first synchronous OpenAI
// call from apps/api (every prior LLM integration - clip-scoring, subtitle-
// translate - only ever ran inside apps/worker as a BullMQ job).
//
// Lazily constructed, NOT a module-scope singleton like apps/worker's own
// openai.ts - confirmed via a real test failure that the openai@6 SDK's
// constructor itself throws immediately when no apiKey is available (not
// "only throws once a call is actually made", which is what that worker
// file's own comment assumes). Constructing it eagerly at module-load time
// would crash the whole apps/api process at boot whenever OPENAI_API_KEY is
// unset, not just make this one feature unavailable - the opposite of the
// "fails loudly only when the feature is actually used" posture this env
// var is supposed to have. Callers must check isAiSearchEnabled() first
// (ClipQueryParserService already does) before calling getOpenAiClient().
let client: OpenAI | null = null;

// This client backs a SYNCHRONOUS, user-facing HTTP request (unlike every
// other OpenAI call in this codebase, which runs inside an apps/worker
// BullMQ job with no one actively waiting on it) - the SDK's own defaults
// (a 600_000ms/10-minute timeout, up to 2 retries on top of that) are wrong
// here and were never meant for a request a person is watching a spinner
// for. AI_SEARCH_TIMEOUT_MS bounds a single attempt to a real "reasonable
// or fail" window; AI_SEARCH_MAX_RETRIES keeps one retry for a transient
// blip (a dropped connection, a momentary 5xx) without letting the SDK's
// default of 2 balloon the worst case toward a minute-plus hang.
const AI_SEARCH_TIMEOUT_MS = 20_000;
const AI_SEARCH_MAX_RETRIES = 1;

export function isAiSearchEnabled(): boolean {
  return Boolean(process.env.OPENAI_API_KEY);
}

export function getOpenAiClient(): OpenAI {
  if (!client) {
    client = new OpenAI({
      apiKey: process.env.OPENAI_API_KEY,
      timeout: AI_SEARCH_TIMEOUT_MS,
      maxRetries: AI_SEARCH_MAX_RETRIES,
    });
  }
  return client;
}
