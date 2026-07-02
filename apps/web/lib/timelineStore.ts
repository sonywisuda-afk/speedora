import type { Clip, TranscriptSegment } from '@viral-clip-app/shared';
import { create } from 'zustand';
import { getVideo, renderClip as renderClipApi, updateClip as updateClipApi } from './api';

const RENDER_POLL_INTERVAL_MS = 2000;
const RENDER_POLL_TIMEOUT_MS = 120000;

export interface TimelineClip {
  id: string;
  videoId: string;
  startTime: number;
  endTime: number;
  viralityScore: number;
  downloadUrl: string | null;
  updatedAt: string;
  // Local trim in progress, not yet persisted via PATCH /clips/:id.
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
  clips: TimelineClip[];
  selectedClipId: string | null;
  playhead: number;

  load(videoId: string, clips: Clip[], transcript: TranscriptSegment[]): void;
  setDuration(duration: number): void;
  setPlayhead(time: number): void;
  selectClip(id: string): void;
  setClipRange(id: string, startTime: number, endTime: number): void;
  saveClip(id: string): Promise<void>;
  renderClip(id: string): Promise<void>;
}

function toTimelineClip(clip: Clip): TimelineClip {
  return {
    id: clip.id,
    videoId: clip.videoId,
    startTime: clip.startTime,
    endTime: clip.endTime,
    viralityScore: clip.viralityScore,
    downloadUrl: clip.downloadUrl,
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

  async saveClip(id) {
    const clip = get().clips.find((c) => c.id === id);
    if (!clip) return;

    set((state) => ({
      clips: state.clips.map((c) => (c.id === id ? { ...c, saving: true, saveError: null } : c)),
    }));

    try {
      const updated = await updateClipApi(id, { startTime: clip.startTime, endTime: clip.endTime });
      set((state) => ({
        clips: state.clips.map((c) =>
          c.id === id
            ? {
                ...c,
                startTime: updated.startTime,
                endTime: updated.endTime,
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
}));
