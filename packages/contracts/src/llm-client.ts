import { z } from 'zod';

// AI Intelligence v4, Phase 0 (see docs/ai/intelligence-v4.md) - extracts the
// OpenAI structured-JSON-output call shape already independently
// reimplemented 4 times in this codebase (packages/clip-scoring,
// packages/subtitle-translate, packages/seo-copy,
// packages/clip-query-parser), each with its own hand-written
// `response_format.json_schema` object, its own `model: 'gpt-4o-mini'`
// literal, its own `deps.openai` injection, and its own manual
// sanitize-then-Zod-reparse - past this codebase's own "extract at the 3rd
// duplication" threshold (docs/coding-standards.md) with nothing done about
// it until now. New v4 LLM-reasoning modules (starting with
// packages/hook-prediction) use this instead of writing a 5th copy.
//
// Deliberately thin: no retry/backoff, no token/cost tracking - none of the
// 4 existing call sites has either, and adding either now would be new
// behavior beyond a pure extraction. The 4 existing call sites are NOT
// migrated to this in this pass (zero behavior change budget) - this is
// additive infrastructure only.

export const structuredCallMessageSchema = z.object({
  role: z.enum(['system', 'user']),
  content: z.string(),
});
export type StructuredCallMessage = z.infer<typeof structuredCallMessageSchema>;

export const jsonSchemaResponseFormatSchema = z.object({
  name: z.string(),
  // The raw OpenAI JSON-Schema object for this call's `strict: true`
  // response format - deliberately z.record(unknown), not a typed
  // JSON-Schema validator (this codebase has no JSON-Schema-validation
  // dependency, and OpenAI's own `strict: true` mode already enforces shape
  // compliance at the API boundary; this contract's job is to plumb the
  // schema through, not re-validate JSON-Schema semantics itself).
  schema: z.record(z.string(), z.unknown()),
});
export type JsonSchemaResponseFormat = z.infer<typeof jsonSchemaResponseFormatSchema>;

export const structuredCallInputSchema = z.object({
  model: z.string(),
  messages: z.array(structuredCallMessageSchema).min(1),
  responseFormat: jsonSchemaResponseFormatSchema,
});
export type StructuredCallInput = z.infer<typeof structuredCallInputSchema>;
