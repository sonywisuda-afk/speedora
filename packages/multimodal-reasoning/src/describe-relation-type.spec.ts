import { MULTIMODAL_RELATION_TYPES } from '@speedora/contracts';
import { describeRelationType } from './describe-relation-type';

describe('describeRelationType', () => {
  it.each(MULTIMODAL_RELATION_TYPES)('returns a non-empty description for %s', (type) => {
    expect(describeRelationType(type).length).toBeGreaterThan(0);
  });
});
