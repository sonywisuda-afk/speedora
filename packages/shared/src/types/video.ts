export enum VideoStatus {
  UPLOADED = 'UPLOADED',
  TRANSCRIBED = 'TRANSCRIBED',
  CLIPS_DETECTED = 'CLIPS_DETECTED',
  RENDERED = 'RENDERED',
  FAILED = 'FAILED',
}

export interface TranscriptSegment {
  start: number;
  end: number;
  text: string;
  speaker?: string;
}

export interface ClipCandidate {
  id: string;
  videoId: string;
  startTime: number;
  endTime: number;
  viralityScore: number;
  transcript: TranscriptSegment[];
}

export interface Video {
  id: string;
  ownerId: string;
  sourceUrl: string;
  status: VideoStatus;
  durationSeconds?: number;
  createdAt: string;
  updatedAt: string;
}
