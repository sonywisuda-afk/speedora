/** @jest-environment jsdom */
import '@testing-library/jest-dom';
import { fireEvent, render, screen } from '@testing-library/react';
import type { Clip, TranscriptSegment } from '@speedora/shared';
import { useTimelineStore } from '@/lib/timelineStore';
import { TimelineEditor } from './TimelineEditor';

// TimelineEditor pulls in @/lib/subtitleFonts, which calls next/font/google
// at module load time (Inter/Poppins/etc.) - not runnable under plain Jest
// without Next's own SWC transform, so it needs a stub returning the same
// { style: { fontFamily }, className } shape every one of those calls
// produces.
jest.mock('next/font/google', () => {
  const stub = () => ({ style: { fontFamily: 'mock-font' }, className: 'mock-font' });
  return {
    Inter: stub,
    Lato: stub,
    Montserrat: stub,
    Nunito: stub,
    Open_Sans: stub,
    Oswald: stub,
    Poppins: stub,
    Roboto: stub,
  };
});

jest.mock('@/lib/api', () => ({
  clipDownloadUrl: (id: string) => `/api/clips/${id}/download`,
  createSubtitlePreset: jest.fn(),
  listSubtitlePresets: jest.fn().mockResolvedValue({ presets: [] }),
  videoSourceUrl: (id: string) => `/api/videos/${id}/source`,
}));

// Phase F (accessibility hardening) - TimelineEditor had no test file at
// all before this pass (confirmed via the accessibility survey). These
// cover only the new keyboard-operability behavior (clip selection, trim
// handle nudging) added in this same pass, not a full component test suite.
function baseClip(overrides: Partial<Clip> = {}): Clip {
  return {
    id: 'clip-1',
    videoId: 'video-1',
    startTime: 10,
    endTime: 20,
    viralityScore: null,
    downloadUrl: null,
    captionStyle: 'DEFAULT',
    speakerColorCaptions: false,
    captionLanguage: null,
    fontFamily: null,
    watermarkEnabled: false,
    introEnabled: false,
    outroEnabled: false,
    hookText: null,
    hashtags: [],
    scores: null,
    reason: null,
    topics: [],
    keywords: [],
    intent: null,
    ctaText: null,
    updatedAt: '2026-08-01T00:00:00.000Z',
    ...overrides,
  } as unknown as Clip;
}

function seedStore(clips: Clip[], transcript: TranscriptSegment[] = []) {
  useTimelineStore.getState().load('video-1', clips, transcript);
  useTimelineStore.getState().setDuration(60);
}

describe('TimelineEditor - keyboard accessibility', () => {
  beforeEach(() => {
    useTimelineStore.setState({
      videoId: null,
      duration: 0,
      transcript: [],
      transcriptError: null,
      clips: [],
      selectedClipId: null,
      playhead: 0,
    });
  });

  it('selects a clip via the keyboard (Enter) without a mouse click', async () => {
    seedStore([baseClip({ id: 'clip-1' }), baseClip({ id: 'clip-2', startTime: 30, endTime: 40 })]);
    // load() auto-selects the first clip - deselect first so the test
    // actually exercises the keyboard select path, not the default state.
    useTimelineStore.getState().selectClip('clip-2');

    render(<TimelineEditor videoId="video-1" />);

    // findByRole (not getByRole) so the pending listSubtitlePresets SWR
    // fetch settles before interacting - avoids a spurious act() warning
    // from that unrelated in-flight request.
    const clipButton = await screen.findByRole('button', { name: /10\.0s - 20\.0s/ });
    fireEvent.keyDown(clipButton, { key: 'Enter' });

    expect(useTimelineStore.getState().selectedClipId).toBe('clip-1');
  });

  it('selects a clip via the keyboard (Space)', async () => {
    seedStore([baseClip({ id: 'clip-1' }), baseClip({ id: 'clip-2', startTime: 30, endTime: 40 })]);
    useTimelineStore.getState().selectClip('clip-2');

    render(<TimelineEditor videoId="video-1" />);

    const clipButton = await screen.findByRole('button', { name: /10\.0s - 20\.0s/ });
    fireEvent.keyDown(clipButton, { key: ' ' });

    expect(useTimelineStore.getState().selectedClipId).toBe('clip-1');
  });

  it('nudges the start trim handle right via the arrow key, in TRIM_STEP_SECONDS increments', async () => {
    seedStore([baseClip({ id: 'clip-1', startTime: 10, endTime: 20 })]);

    render(<TimelineEditor videoId="video-1" />);

    const startHandle = await screen.findByRole('slider', { name: 'Awal klip' });
    fireEvent.keyDown(startHandle, { key: 'ArrowRight' });

    const clip = useTimelineStore.getState().clips.find((c) => c.id === 'clip-1');
    expect(clip?.startTime).toBeCloseTo(10.1);
    expect(clip?.endTime).toBe(20);
  });

  it('nudges the end trim handle by the larger Shift+Arrow step', async () => {
    seedStore([baseClip({ id: 'clip-1', startTime: 10, endTime: 20 })]);

    render(<TimelineEditor videoId="video-1" />);

    const endHandle = await screen.findByRole('slider', { name: 'Akhir klip' });
    fireEvent.keyDown(endHandle, { key: 'ArrowLeft', shiftKey: true });

    const clip = useTimelineStore.getState().clips.find((c) => c.id === 'clip-1');
    expect(clip?.endTime).toBe(19);
    expect(clip?.startTime).toBe(10);
  });

  it('never trims a clip below MIN_CLIP_SECONDS via repeated keyboard nudges', async () => {
    seedStore([baseClip({ id: 'clip-1', startTime: 10, endTime: 11.5 })]);

    render(<TimelineEditor videoId="video-1" />);

    const startHandle = await screen.findByRole('slider', { name: 'Awal klip' });
    // Repeated large nudges toward the end edge - must clamp, never cross it.
    for (let i = 0; i < 10; i++) {
      fireEvent.keyDown(startHandle, { key: 'ArrowRight', shiftKey: true });
    }

    const clip = useTimelineStore.getState().clips.find((c) => c.id === 'clip-1');
    expect(clip?.startTime).toBeLessThanOrEqual(10.5);
    expect(clip?.endTime).toBe(11.5);
  });
});
