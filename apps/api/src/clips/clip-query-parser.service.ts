import { BadRequestException, Injectable, ServiceUnavailableException } from '@nestjs/common';
import { parseClipQuery } from '@speedora/clip-query-parser';
import type { ClipLibraryFilterParams } from '@speedora/shared';
import { getOpenAiClient, isAiSearchEnabled } from '../openai';
import { PrismaService } from '../prisma/prisma.service';
import { ClipsService } from './clips.service';

// Natural Language AI Search roadmap (P4) - same rolling-24h-window count
// limiter shape as VideosService's TranscriptTranslationRequest rate limit,
// just a materially higher cap: a search is a lighter, more-repeatable
// action than a batch translate job, and unlike translate this table isn't
// tied to a specific video (a search query isn't scoped to one video).
const MAX_AI_SEARCH_REQUESTS_PER_DAY = 20;
const RATE_LIMIT_WINDOW_MS = 24 * 60 * 60 * 1000;

export interface ParseQueryResult {
  filters: Partial<ClipLibraryFilterParams>;
  summary: string;
}

// Sibling file to ClipsService rather than folded into it - this needs its
// own OpenAI/rate-limit concerns that don't belong on the already-large
// ClipsService, but stays routed under /clips (see ClipsController) since
// it's structurally a clips-adjacent helper endpoint, the same way
// GET /clips/facets already is.
@Injectable()
export class ClipQueryParserService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly clipsService: ClipsService,
  ) {}

  async parseQuery(
    userId: string,
    query: string,
    target: { workspaceId?: string; projectId?: string },
  ): Promise<ParseQueryResult> {
    if (!isAiSearchEnabled()) {
      throw new ServiceUnavailableException('Pencarian AI belum dikonfigurasi');
    }

    const since = new Date(Date.now() - RATE_LIMIT_WINDOW_MS);
    const recentCount = await this.prisma.aiSearchRequest.count({
      where: { userId, createdAt: { gte: since } },
    });
    if (recentCount >= MAX_AI_SEARCH_REQUESTS_PER_DAY) {
      throw new BadRequestException(
        `AI search limit reached (${MAX_AI_SEARCH_REQUESTS_PER_DAY}/24h) - try again later.`,
      );
    }
    // Counts toward the limit regardless of whether parsing below succeeds -
    // same "the attempt is what's rate-limited" posture as translate's own
    // TranscriptTranslationRequest.
    await this.prisma.aiSearchRequest.create({ data: { userId, query } });

    const { topics } = await this.clipsService.getTopicFacets(userId, target);
    const availableTopics = topics.map((t) => t.value);

    // Bounded to AI_SEARCH_TIMEOUT_MS (see openai.ts) so this never hangs
    // the request past a "reasonable or fail" window. Any failure here -
    // timeout, network error, malformed model output - is a transient
    // upstream problem, not a bug in this endpoint itself, so it's
    // deliberately caught and re-thrown as a clean 503 with a plain-
    // language message rather than letting the raw SDK error surface as a
    // generic 500 (whose message would otherwise reach the user verbatim -
    // see AiSearchBar.tsx, which just displays err.message on failure).
    let parsed: Awaited<ReturnType<typeof parseClipQuery>>;
    try {
      parsed = await parseClipQuery({ query, availableTopics }, { openai: getOpenAiClient() });
    } catch {
      throw new ServiceUnavailableException(
        'Pencarian AI sedang tidak tersedia, coba lagi sebentar lagi.',
      );
    }

    const { summary, ...filters } = parsed;
    return { filters, summary };
  }
}
