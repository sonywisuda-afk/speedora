import type { StructuredCallInput } from '@speedora/contracts';
import type OpenAI from 'openai';

// The OpenAI client is injected, never constructed from process.env in here
// - the caller (an apps/worker adapter) owns that singleton and its env var,
// same reasoning as clip-scoring's ScoreClipCandidatesDeps (see this
// package's own doc comment / ARCHITECTURE.md's `deps` convention).
export interface StructuredCallDeps {
  openai: OpenAI;
}

// Thin wrapper around deps.openai.chat.completions.create's structured
// (json_schema, strict) output mode - see packages/contracts/src/
// llm-client.ts for why it's this shape. Returns the parsed JSON body
// UNVALIDATED against any caller-side schema: this wrapper doesn't know what
// shape a given caller expects, so every call site is expected to re-parse
// the result through its own Zod output schema afterward - belt-and-
// suspenders on top of OpenAI's own `strict: true`, same as every existing
// LLM call site in this codebase already does independently.
//
// Throws (does not catch) when the completion has no content - "module
// throws, adapter catches" (docs/testing.md); the caller decides whether a
// missing/empty LLM response should fail the job or fall back to a default.
export async function callStructured<T>(
  input: StructuredCallInput,
  deps: StructuredCallDeps,
): Promise<T> {
  const completion = await deps.openai.chat.completions.create({
    model: input.model,
    messages: input.messages,
    response_format: {
      type: 'json_schema',
      json_schema: {
        name: input.responseFormat.name,
        strict: true,
        schema: input.responseFormat.schema,
      },
    },
  });

  const raw = completion.choices[0]?.message?.content;
  if (!raw) {
    throw new Error('callStructured: LLM completion returned no content.');
  }
  return JSON.parse(raw) as T;
}
