# Scoring systems — how they relate

This codebase has **four** distinct numeric "how good is this clip" systems, built at different
times for different purposes. They are easy to conflate; this doc exists to disambiguate them. See
`ai/llm.md`, `ai/fusion.md`, and `ai/intelligence-v4.md` for full detail on each.

## 1. `Clip.viralityScore` — the original LLM selection score

Produced by `packages/clip-scoring`'s single LLM call (`ai/llm.md`), 0–100. This is the score used
to **select** which 1–3 candidate moments become clips in the first place — it exists before a
clip has even been rendered, let alone analyzed visually. A single heuristic number, no breakdown.

## 2. `ClipScores` — the 9-dimension LLM breakdown

Also from the same `clip-scoring` LLM call, stored in `Clip.scores`. Explains *why* a clip scored
the way it did across 9 named dimensions grouped into `engagement`/`knowledge`/`conversion`
domains (`SCORE_DOMAINS`, `ai/fusion.md`). This is "explainable AI" applied to the *selection*
score — it doesn't produce a new top-line number, it decomposes the reasoning behind
`viralityScore`.

`ClipScores` is also the one bridge between the LLM's read of the *transcript* and the Fusion
Engine's otherwise entirely audio/visual signal set — it's passed through the `render-clip` job
payload and consumed there as the Fusion Engine's `llm` signal (weight 5%, `ai/fusion.md`).

## 3. `Clip.highlightScore` — the Fusion Engine's multi-modal score

Produced by `packages/fusion-engine` **after** rendering, combining `audio`/`scene`/`facial`/`ocr`/
`llm` (and several weight-0 collected-but-uncalibrated signals) into one weighted score, with
`highlightConfidence`, `highlightBreakdown`/`highlightExplainability` (per-feature contributions,
not per-dimension like `ClipScores`), and `highlightPrediction`/`highlightRecommendation`. This is
the score meant to eventually inform *ranking/recommendation* across a video's already-selected
clips (`highlightRank`), not clip selection itself.

## 4. `Clip.viralityPrediction` — AI Intelligence v4's cross-module fusion estimate

Produced by `packages/virality-engine` (AI Intelligence v4 Phase 7, `ai/intelligence-v4.md`),
**after** rendering and **after** Phases 1/3/4/5 have already run. A JSON object — 8 heuristic
sub-probabilities (`subProbabilities`, 2 fused from each of Hook Prediction/Narrative Graph/
Contextual Momentum/Emotional Arc's own already-computed outputs) plus one composite
`viralityProbability` (0-1) and a coverage-only `confidence`. No new LLM call, no new detector — a
pure, synchronous *fusion* of v4's own already-computed signals, gated behind
`VIRALITY_ENGINE_ENABLED` and exposed only via `GET /clips/:id/intelligence`
(`ClipIntelligenceDto.viralityPrediction`), never through the same endpoints/fields as the other
three systems above.

**This is easy to confuse with `Clip.viralityScore` (system 1) specifically — don't.** Despite the
shared "virality" name (kept for direct traceability to the original spec's own naming, spec Part
4 = "Virality Engine"), they have nothing in common: `viralityScore` is a single 0-100 number from
one LLM call, computed *before* render, used to *select* which candidate moments become clips.
`viralityPrediction` is a JSON breakdown computed *after* render by fusing four other v4 modules'
outputs, and never influences clip selection or `highlightRank` at all — it exists purely as an
additional, explainable, opt-in read for a caller (`GET /clips/:id/intelligence`), same as every
other v4 field (`hookPrediction`/`semanticEvents`/`narrativeGraph`/`contextualMomentum`/
`emotionalArc`/`multiSpeakerBreakdown`). Never mix a `viralityPrediction.viralityProbability`
(0-1) with `viralityScore` (0-100) in the same UI comparison or calculation.

## Why four systems, not one

`viralityScore`/`ClipScores` exist because they're cheap (one LLM call, before any rendering work
happens) and are the only signal available at the moment clips are being *chosen* out of a full
transcript. `highlightScore` exists because, once a clip is actually rendered, far more signal is
available (real audio loudness, real scene cuts, real facial expression, real on-screen text) than
an LLM reading a transcript could ever infer — and unifying that into `ClipScores` retroactively
would mean re-running an LLM call after every render, for no clear benefit over a purpose-built
weighted-feature engine. `viralityPrediction` exists because AI Intelligence v4 (an entirely
separate, additive initiative — see `ai/intelligence-v4.md`'s ADR D1) needed its own "how likely is
this to perform" read built purely from v4's own already-computed signals, without touching either
of the pre-existing systems or the Fusion Engine's `FUSION_INPUT_MAP`/`computeHighlightScore`
(ADR D1's core rule). Whether these should eventually be merged into one system (e.g. by having the
Fusion Engine directly gate which candidates get selected in the first place, rather than only
scoring what's already been selected) is an open architectural question — see `ai/fusion.md`'s note
on the spec's "analyze everything, then select" ordering vs. this codebase's "select first, then
analyze" ordering.
