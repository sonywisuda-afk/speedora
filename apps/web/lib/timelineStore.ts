import type {
  BuiltInSubtitlePreset,
  CaptionStyle,
  Clip,
  ClipScores,
  SubtitlePresetDto,
  TranscriptSegment,
} from '@speedora/shared';
import { create } from 'zustand';
import {
  getVideo,
  mergeTranscriptSegments as mergeTranscriptSegmentsApi,
  renderClip as renderClipApi,
  splitTranscriptSegment as splitTranscriptSegmentApi,
  translateTranscript as translateTranscriptApi,
  updateClip as updateClipApi,
  updateTranscriptSegment as updateTranscriptSegmentApi,
} from './api';

const RENDER_POLL_INTERVAL_MS = 2000;
const RENDER_POLL_TIMEOUT_MS = 120000;

// Subtitle Presets roadmap (P3b) - the 3 fields a custom SubtitlePreset
// actually applies; a plain Pick rather than the full SubtitlePresetDto so
// applyPreset() doesn't need an id/name/timestamps just to bulk-set a clip.
type SubtitlePresetFields = Pick<
  SubtitlePresetDto,
  'captionStyle' | 'speakerColorCaptions' | 'fontFamily'
>;

export interface TimelineClip {
  id: string;
  videoId: string;
  startTime: number;
  endTime: number;
  viralityScore: number;
  downloadUrl: string | null;
  captionStyle: CaptionStyle;
  // Subtitle Studio roadmap (P2c/P2f) - orthogonal to captionStyle, same
  // dirty/save flow as every other field on this row.
  speakerColorCaptions: boolean;
  captionLanguage: string | null;
  // Subtitle Presets roadmap (P3b) - per-clip override of the resolved
  // caption font; null means "use Brand Kit resolution", same shape as
  // captionLanguage above.
  fontFamily: string | null;
  // Watermark roadmap (P3c) - per-clip on/off gate for the owner's Brand
  // Kit watermark, same shape as applyBrandKit (composable with it).
  watermarkEnabled: boolean;
  // Intro roadmap (P3d) - per-clip on/off gate, same shape as
  // watermarkEnabled above.
  introEnabled: boolean;
  // Suggested opener line/hashtags from the detect-clips LLM call - purely
  // metadata (not baked into the rendered video), editable same as
  // captionStyle below.
  hookText: string | null;
  hashtags: string[];
  // Fase 8 (Content Intelligence) - read-only, from the same detect-clips
  // LLM call as viralityScore/hookText/hashtags above. Not user-editable in
  // this phase (unlike the fields above), so there's no setter for these.
  scores: ClipScores | null;
  reason: string | null;
  topics: string[];
  keywords: string[];
  intent: string | null;
  ctaText: string | null;
  updatedAt: string;
  // Local trim/style change in progress, not yet persisted via
  // PATCH /clips/:id.
  dirty: boolean;
  saving: boolean;
  saveError: string | null;
  rendering: boolean;
  renderError: string | null;
}

interface TimelineState {
  videoId: string | null;
  duration: number;
  transcript: TranscriptSegment[];
  // Subtitle Studio roadmap (P2) - shared across edit/merge/split/translate
  // (one panel, one error slot at a time) rather than a per-action flag -
  // simpler than threading per-segment saving/error state through every
  // row for what's a single-user, one-edit-at-a-time editing surface.
  transcriptError: string | null;
  clips: TimelineClip[];
  selectedClipId: string | null;
  playhead: number;

  load(videoId: string, clips: Clip[], transcript: TranscriptSegment[]): void;
  setDuration(duration: number): void;
  setPlayhead(time: number): void;
  selectClip(id: string): void;
  setClipRange(id: string, startTime: number, endTime: number): void;
  setCaptionStyle(id: string, captionStyle: CaptionStyle): void;
  setSpeakerColorCaptions(id: string, speakerColorCaptions: boolean): void;
  setCaptionLanguage(id: string, captionLanguage: string | null): void;
  setFontFamily(id: string, fontFamily: string | null): void;
  // Subtitle Presets roadmap (P3b) - bulk-sets captionStyle/
  // speakerColorCaptions/fontFamily in one state update (avoids 3 separate
  // re-renders from calling each individual setter) - a convenience layer
  // on top of the granular setters above, not a replacement for them (the
  // user can still fine-tune any single field after applying a preset).
  applyPreset(id: string, preset: BuiltInSubtitlePreset | SubtitlePresetFields): void;
  // Watermark roadmap (P3c) - same shape as applyBrandKit would be if it had
  // frontend surface (it doesn't yet - see /brand-kit page's own comment).
  setWatermarkEnabled(id: string, watermarkEnabled: boolean): void;
  // Intro roadmap (P3d) - same shape as setWatermarkEnabled above.
  setIntroEnabled(id: string, introEnabled: boolean): void;
  setHookText(id: string, hookText: string): void;
  setHashtags(id: string, hashtags: string[]): void;
  saveClip(id: string): Promise<void>;
  renderClip(id: string): Promise<void>;

  // Subtitle Studio roadmap (P2a/P2b/P2f) - unlike setCaptionStyle/
  // setHookText above (local-only until saveClip), these hit the API
  // immediately (there's no separate "save transcript" step - each edit is
  // its own persisted action) and patch `transcript` in place on success.
  updateSegmentText(videoId: string, segmentId: string, text: string): Promise<void>;
  mergeSegments(videoId: string, firstSegmentId: string, secondSegmentId: string): Promise<void>;
  splitSegment(videoId: string, segmentId: string, atWordIndex: number): Promise<void>;
  requestTranslation(videoId: string, languageCode: string): Promise<void>;
}

function toTimelineClip(clip: Clip): TimelineClip {
  return {
    id: clip.id,
    videoId: clip.videoId,
    startTime: clip.startTime,
    endTime: clip.endTime,
    viralityScore: clip.viralityScore,
    downloadUrl: clip.downloadUrl,
    captionStyle: clip.captionStyle,
    speakerColorCaptions: clip.speakerColorCaptions,
    captionLanguage: clip.captionLanguage,
    fontFamily: clip.fontFamily,
    watermarkEnabled: clip.watermarkEnabled,
    introEnabled: clip.introEnabled,
    hookText: clip.hookText,
    hashtags: clip.hashtags,
    scores: clip.scores,
    reason: clip.reason,
    topics: clip.topics,
    keywords: clip.keywords,
    intent: clip.intent,
    ctaText: clip.ctaText,
    updatedAt: clip.updatedAt,
    dirty: false,
    saving: false,
    saveError: null,
    rendering: false,
    renderError: null,
  };
}

export const useTimelineStore = create<TimelineState>((set, get) => ({
  videoId: null,
  duration: 0,
  transcript: [],
  transcriptError: null,
  clips: [],
  selectedClipId: null,
  playhead: 0,

  load(videoId, clips, transcript) {
    const timelineClips = clips.map(toTimelineClip);
    set({
      videoId,
      transcript,
      clips: timelineClips,
      selectedClipId: timelineClips[0]?.id ?? null,
      playhead: 0,
    });
  },

  setDuration(duration) {
    set({ duration });
  },

  setPlayhead(time) {
    set({ playhead: time });
  },

  selectClip(id) {
    set({ selectedClipId: id });
  },

  setClipRange(id, startTime, endTime) {
    set((state) => ({
      clips: state.clips.map((clip) =>
        clip.id === id ? { ...clip, startTime, endTime, dirty: true, saveError: null } : clip,
      ),
    }));
  },

  setCaptionStyle(id, captionStyle) {
    set((state) => ({
      clips: state.clips.map((clip) =>
        clip.id === id ? { ...clip, captionStyle, dirty: true, saveError: null } : clip,
      ),
    }));
  },

  setSpeakerColorCaptions(id, speakerColorCaptions) {
    set((state) => ({
      clips: state.clips.map((clip) =>
        clip.id === id ? { ...clip, speakerColorCaptions, dirty: true, saveError: null } : clip,
      ),
    }));
  },

  setCaptionLanguage(id, captionLanguage) {
    set((state) => ({
      clips: state.clips.map((clip) =>
        clip.id === id ? { ...clip, captionLanguage, dirty: true, saveError: null } : clip,
      ),
    }));
  },

  setFontFamily(id, fontFamily) {
    set((state) => ({
      clips: state.clips.map((clip) =>
        clip.id === id ? { ...clip, fontFamily, dirty: true, saveError: null } : clip,
      ),
    }));
  },

  applyPreset(id, preset) {
    set((state) => ({
      clips: state.clips.map((clip) =>
        clip.id === id
          ? {
              ...clip,
              captionStyle: preset.captionStyle,
              speakerColorCaptions: preset.speakerColorCaptions,
              fontFamily: preset.fontFamily,
              dirty: true,
              saveError: null,
            }
          : clip,
      ),
    }));
  },

  setWatermarkEnabled(id, watermarkEnabled) {
    set((state) => ({
      clips: state.clips.map((clip) =>
        clip.id === id ? { ...clip, watermarkEnabled, dirty: true, saveError: null } : clip,
      ),
    }));
  },

  setIntroEnabled(id, introEnabled) {
    set((state) => ({
      clips: state.clips.map((clip) =>
        clip.id === id ? { ...clip, introEnabled, dirty: true, saveError: null } : clip,
      ),
    }));
  },

  setHookText(id, hookText) {
    set((state) => ({
      clips: state.clips.map((clip) =>
        clip.id === id ? { ...clip, hookText, dirty: true, saveError: null } : clip,
      ),
    }));
  },

  setHashtags(id, hashtags) {
    set((state) => ({
      clips: state.clips.map((clip) =>
        clip.id === id ? { ...clip, hashtags, dirty: true, saveError: null } : clip,
      ),
    }));
  },

  async saveClip(id) {
    const clip = get().clips.find((c) => c.id === id);
    if (!clip) return;

    set((state) => ({
      clips: state.clips.map((c) => (c.id === id ? { ...c, saving: true, saveError: null } : c)),
    }));

    try {
      const updated = await updateClipApi(id, {
        startTime: clip.startTime,
        endTime: clip.endTime,
        captionStyle: clip.captionStyle,
        speakerColorCaptions: clip.speakerColorCaptions,
        captionLanguage: clip.captionLanguage,
        fontFamily: clip.fontFamily,
        watermarkEnabled: clip.watermarkEnabled,
        introEnabled: clip.introEnabled,
        hookText: clip.hookText ?? undefined,
        hashtags: clip.hashtags,
      });
      set((state) => ({
        clips: state.clips.map((c) =>
          c.id === id
            ? {
                ...c,
                startTime: updated.startTime,
                endTime: updated.endTime,
                captionStyle: updated.captionStyle,
                speakerColorCaptions: updated.speakerColorCaptions,
                captionLanguage: updated.captionLanguage,
                fontFamily: updated.fontFamily,
                watermarkEnabled: updated.watermarkEnabled,
                introEnabled: updated.introEnabled,
                hookText: updated.hookText,
                hashtags: updated.hashtags,
                updatedAt: updated.updatedAt,
                dirty: false,
                saving: false,
              }
            : c,
        ),
      }));
    } catch (err) {
      set((state) => ({
        clips: state.clips.map((c) =>
          c.id === id
            ? {
                ...c,
                saving: false,
                saveError: err instanceof Error ? err.message : 'Save failed',
              }
            : c,
        ),
      }));
    }
  },

  async renderClip(id) {
    const { videoId } = get();
    if (!videoId) return;

    set((state) => ({
      clips: state.clips.map((c) =>
        c.id === id ? { ...c, rendering: true, renderError: null } : c,
      ),
    }));

    try {
      const started = await renderClipApi(id);
      const startedAt = started.updatedAt;

      const deadline = Date.now() + RENDER_POLL_TIMEOUT_MS;
      // eslint-disable-next-line no-constant-condition
      while (true) {
        await new Promise((resolve) => setTimeout(resolve, RENDER_POLL_INTERVAL_MS));
        const video = await getVideo(videoId);
        const latest = video.clips.find((c) => c.id === id);

        if (latest && latest.updatedAt !== startedAt && latest.downloadUrl) {
          set((state) => ({
            clips: state.clips.map((c) =>
              c.id === id
                ? {
                    ...c,
                    downloadUrl: latest.downloadUrl,
                    updatedAt: latest.updatedAt,
                    rendering: false,
                  }
                : c,
            ),
          }));
          return;
        }

        if (Date.now() > deadline) {
          throw new Error('Timed out waiting for render to finish');
        }
      }
    } catch (err) {
      set((state) => ({
        clips: state.clips.map((c) =>
          c.id === id
            ? {
                ...c,
                rendering: false,
                renderError: err instanceof Error ? err.message : 'Render failed',
              }
            : c,
        ),
      }));
    }
  },

  async updateSegmentText(videoId, segmentId, text) {
    try {
      const updated = await updateTranscriptSegmentApi(videoId, segmentId, text);
      set((state) => ({
        transcript: state.transcript.map((s) => (s.id === segmentId ? updated : s)),
        transcriptError: null,
      }));
    } catch (err) {
      set({ transcriptError: err instanceof Error ? err.message : 'Gagal menyimpan teks' });
    }
  },

  async mergeSegments(videoId, firstSegmentId, secondSegmentId) {
    try {
      const merged = await mergeTranscriptSegmentsApi(videoId, firstSegmentId, secondSegmentId);
      set((state) => ({
        // The merged row keeps firstSegmentId's id and absorbs
        // secondSegmentId's - drop the second row, replace the first.
        transcript: state.transcript
          .filter((s) => s.id !== secondSegmentId)
          .map((s) => (s.id === firstSegmentId ? merged : s)),
        transcriptError: null,
      }));
    } catch (err) {
      set({ transcriptError: err instanceof Error ? err.message : 'Gagal menggabungkan segmen' });
    }
  },

  async splitSegment(videoId, segmentId, atWordIndex) {
    try {
      const { segments } = await splitTranscriptSegmentApi(videoId, segmentId, atWordIndex);
      const [first, second] = segments;
      set((state) => {
        const index = state.transcript.findIndex((s) => s.id === segmentId);
        if (index === -1) return { transcript: state.transcript, transcriptError: null };
        const next = [...state.transcript];
        next.splice(index, 1, first, second);
        return { transcript: next, transcriptError: null };
      });
    } catch (err) {
      set({ transcriptError: err instanceof Error ? err.message : 'Gagal membagi segmen' });
    }
  },

  async requestTranslation(videoId, languageCode) {
    try {
      await translateTranscriptApi(videoId, languageCode);
      // Fire-and-forget on the server side (see translateTranscript's own
      // comment) - the caller is responsible for re-fetching the
      // transcript later to pick up the finished translations; this store
      // action only surfaces whether the REQUEST itself succeeded.
      set({ transcriptError: null });
    } catch (err) {
      set({ transcriptError: err instanceof Error ? err.message : 'Gagal meminta terjemahan' });
    }
  },
}));
