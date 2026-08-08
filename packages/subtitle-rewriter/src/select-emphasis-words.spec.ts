import type { TranscriptWordInput } from '@speedora/contracts';
import { selectEmphasisWordIndices } from './select-emphasis-words';

function word(text: string, start = 0): TranscriptWordInput {
  return { word: text, start, end: start + 0.3 };
}

describe('selectEmphasisWordIndices', () => {
  it('flags a word containing a digit', () => {
    const words = [word('I'), word('made'), word('100'), word('dollars')];
    expect(selectEmphasisWordIndices(words)).toEqual([2]);
  });

  it('flags an ALL-CAPS word', () => {
    const words = [word('this'), word('is'), word('HUGE')];
    expect(selectEmphasisWordIndices(words)).toEqual([2]);
  });

  it('does not flag an ordinary lowercase/Titlecase word', () => {
    const words = [word('This'), word('is'), word('normal')];
    expect(selectEmphasisWordIndices(words)).toEqual([]);
  });

  it('strips surrounding punctuation before testing', () => {
    const words = [word('"HUGE"'), word('deal.')];
    expect(selectEmphasisWordIndices(words)).toEqual([0]);
  });

  it('returns an empty array for an empty word list', () => {
    expect(selectEmphasisWordIndices([])).toEqual([]);
  });
});
