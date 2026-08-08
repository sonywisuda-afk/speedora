import type { MultimodalEvidence } from '@speedora/contracts';
import { groupEvidenceByTranscriptSegment, selectReasoningGroups } from './group-evidence';
import { evidence } from './test-fixtures';

describe('groupEvidenceByTranscriptSegment', () => {
  it('forms one group per transcript segment', () => {
    const all: MultimodalEvidence[] = [
      evidence({ id: 'transcript:0', modality: 'transcript', startTime: 0, endTime: 2 }),
      evidence({ id: 'transcript:1', modality: 'transcript', startTime: 2, endTime: 4 }),
    ];

    const groups = groupEvidenceByTranscriptSegment(all);

    expect(groups).toHaveLength(2);
    expect(groups[0]).toMatchObject({ segmentIndex: 0, startTime: 0, endTime: 2 });
    expect(groups[1]).toMatchObject({ segmentIndex: 1, startTime: 2, endTime: 4 });
  });

  it("Part 6's own example: transcript + speaker + gesture + OCR + scene overlapping the same moment join one group", () => {
    const all: MultimodalEvidence[] = [
      evidence({
        id: 'transcript:0',
        modality: 'transcript',
        startTime: 10,
        endTime: 11.5,
        value: 'lihat angka ini',
      }),
      evidence({
        id: 'speaker:0',
        modality: 'speaker',
        startTime: 10,
        endTime: 11.5,
        speakerId: 'Speaker A',
      }),
      evidence({
        id: 'gesture:0',
        modality: 'gesture',
        startTime: 10.2,
        endTime: 10.2,
        value: 'pointing_up',
      }),
      evidence({
        id: 'ocr:0',
        modality: 'ocr',
        startTime: 10.8,
        endTime: 11.3,
        value: '$500 Million',
      }),
      evidence({
        id: 'scene:0',
        modality: 'scene',
        startTime: 10.5,
        endTime: 10.5,
        value: 'hard_cut',
      }),
    ];

    const groups = groupEvidenceByTranscriptSegment(all);

    expect(groups).toHaveLength(1);
    const ids = groups[0].evidence.map((item) => item.id).sort();
    expect(ids).toEqual(['gesture:0', 'ocr:0', 'scene:0', 'speaker:0', 'transcript:0'].sort());
  });

  it('does NOT join evidence whose timestamps are far apart (10s vs 90s) into the same group', () => {
    const all: MultimodalEvidence[] = [
      evidence({
        id: 'transcript:0',
        modality: 'transcript',
        startTime: 9.5,
        endTime: 10.5,
        value: 'lihat angka ini',
      }),
      evidence({
        id: 'ocr:0',
        modality: 'ocr',
        startTime: 89.5,
        endTime: 90.5,
        value: '$500 Million',
      }),
    ];

    const groups = groupEvidenceByTranscriptSegment(all);

    expect(groups).toHaveLength(1);
    expect(groups[0].evidence.map((item) => item.id)).toEqual(['transcript:0']);
  });

  it('applies a small padding tolerance around segment bounds, not zero-tolerance touching', () => {
    const all: MultimodalEvidence[] = [
      evidence({ id: 'transcript:0', modality: 'transcript', startTime: 10, endTime: 11 }),
      // Gesture fires 0.3s before the segment starts - within SEGMENT_EVIDENCE_PADDING_SECONDS.
      evidence({ id: 'gesture:0', modality: 'gesture', startTime: 9.7, endTime: 9.7 }),
    ];

    const groups = groupEvidenceByTranscriptSegment(all);

    expect(groups[0].evidence.map((item) => item.id)).toContain('gesture:0');
  });

  it.each`
    label                         | items
    ${'transcript + ocr + scene'} | ${[{ id: 'ocr:0', modality: 'ocr' }, { id: 'scene:0', modality: 'scene' }]}
    ${'transcript + speaker'}     | ${[{ id: 'speaker:0', modality: 'speaker' }]}
    ${'transcript + gesture'}     | ${[{ id: 'gesture:0', modality: 'gesture' }]}
    ${'transcript + face'}        | ${[{ id: 'face:0', modality: 'face' }]}
    ${'transcript + object'}      | ${[{ id: 'object:0', modality: 'object' }]}
  `('handles missing-modality combination: $label', ({ items }) => {
    const all: MultimodalEvidence[] = [
      evidence({ id: 'transcript:0', modality: 'transcript', startTime: 0, endTime: 2 }),
      ...items.map((item: { id: string; modality: MultimodalEvidence['modality'] }) =>
        evidence({ ...item, startTime: 1, endTime: 1 }),
      ),
    ];

    expect(() => groupEvidenceByTranscriptSegment(all)).not.toThrow();
    const groups = groupEvidenceByTranscriptSegment(all);
    expect(groups[0].evidence.length).toBeGreaterThanOrEqual(items.length + 1);
  });

  it('caps same-modality evidence within a group to the closest-to-midpoint items', () => {
    const all: MultimodalEvidence[] = [
      evidence({ id: 'transcript:0', modality: 'transcript', startTime: 0, endTime: 4 }),
      evidence({ id: 'ocr:0', modality: 'ocr', startTime: 1.9, endTime: 2.1, value: 'closest' }),
      evidence({ id: 'ocr:1', modality: 'ocr', startTime: 0.9, endTime: 1.1, value: 'mid' }),
      evidence({ id: 'ocr:2', modality: 'ocr', startTime: 0, endTime: 0.2, value: 'far' }),
      evidence({ id: 'ocr:3', modality: 'ocr', startTime: 3.8, endTime: 4, value: 'far2' }),
    ];

    const groups = groupEvidenceByTranscriptSegment(all);
    const ocrIds = groups[0].evidence
      .filter((item) => item.modality === 'ocr')
      .map((item) => item.id);

    expect(ocrIds).toHaveLength(3);
    expect(ocrIds).toContain('ocr:0');
  });
});

describe('selectReasoningGroups', () => {
  it('drops groups with fewer than 2 distinct modalities (single-modality clip)', () => {
    const groups = groupEvidenceByTranscriptSegment([
      evidence({ id: 'transcript:0', modality: 'transcript', startTime: 0, endTime: 2 }),
    ]);

    expect(selectReasoningGroups(groups)).toEqual([]);
  });

  it('keeps groups with 2+ distinct modalities', () => {
    const groups = groupEvidenceByTranscriptSegment([
      evidence({ id: 'transcript:0', modality: 'transcript', startTime: 0, endTime: 2 }),
      evidence({ id: 'ocr:0', modality: 'ocr', startTime: 1, endTime: 1.5 }),
    ]);

    expect(selectReasoningGroups(groups)).toHaveLength(1);
  });
});
