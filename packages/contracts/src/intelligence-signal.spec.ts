import { z } from 'zod';
import { intelligenceSignalSchema } from './intelligence-signal';

describe('intelligenceSignalSchema', () => {
  const schema = intelligenceSignalSchema(
    z.object({ t: z.number() }),
    z.object({ count: z.number() }),
  );

  it('accepts a valid { raw, features } shape', () => {
    const result = schema.safeParse({ raw: [{ t: 0 }, { t: 1 }], features: { count: 2 } });
    expect(result.success).toBe(true);
  });

  it('accepts an empty raw array', () => {
    const result = schema.safeParse({ raw: [], features: { count: 0 } });
    expect(result.success).toBe(true);
  });

  it('rejects a raw entry that does not match the given raw schema', () => {
    const result = schema.safeParse({ raw: [{ t: 'not-a-number' }], features: { count: 1 } });
    expect(result.success).toBe(false);
  });

  it('rejects a features object that does not match the given features schema', () => {
    const result = schema.safeParse({ raw: [], features: { count: 'not-a-number' } });
    expect(result.success).toBe(false);
  });

  it('rejects a payload missing the features field entirely', () => {
    const result = schema.safeParse({ raw: [] });
    expect(result.success).toBe(false);
  });
});
