import { detectContextDependency } from './detect-context-dependency';

describe('detectContextDependency', () => {
  it('returns 0 penalty for empty text', () => {
    const result = detectContextDependency('', null);
    expect(result.penalty).toBe(0);
  });

  it('flags an unresolved 3rd-person pronoun with no antecedent', () => {
    const result = detectContextDependency('He said it would never work out for them.', null);
    expect(result.penalty).toBeGreaterThan(0);
    expect(result.type).toBe('contextDependency');
  });

  it('does not penalize when a proper-noun antecedent precedes the pronoun', () => {
    const result = detectContextDependency(
      'John Smith walked in and he immediately started talking.',
      null,
    );
    expect(result.penalty).toBe(0);
  });

  it('does not penalize when a role-noun antecedent precedes the pronoun', () => {
    const result = detectContextDependency('The manager arrived and he sat down.', null);
    expect(result.penalty).toBe(0);
  });

  it('never penalizes 1st/2nd-person pronouns', () => {
    const result = detectContextDependency(
      'I told you we would work together on our own project.',
      null,
    );
    expect(result.penalty).toBe(0);
  });

  it('uses namedEntities as an antecedent source in render mode', () => {
    const withoutEntities = detectContextDependency('She finally admitted the truth.', null);
    const withEntities = detectContextDependency('She finally admitted the truth.', ['Maria']);
    // Neither resolves here (Maria never appears in the text itself) - this
    // just proves passing entities doesn't crash and both still flag.
    expect(withoutEntities.penalty).toBeGreaterThan(0);
    expect(withEntities.penalty).toBeGreaterThan(0);

    const resolved = detectContextDependency('Maria walked in. She sat down.', ['Maria']);
    expect(resolved.penalty).toBe(0);
  });

  it('caps the penalty regardless of how many pronouns appear', () => {
    const result = detectContextDependency(
      'He said it. She said it. They said it. It happened.',
      null,
    );
    expect(result.penalty).toBeLessThanOrEqual(24);
  });
});
