import { classifyNodeError } from './nodeErrorClassifier';

function errnoError(code: string): NodeJS.ErrnoException {
  const error = new Error(`simulated ${code}`) as NodeJS.ErrnoException;
  error.code = code;
  return error;
}

describe('classifyNodeError', () => {
  it('maps ENOSPC to disk', () => {
    expect(classifyNodeError(errnoError('ENOSPC'))).toBe('disk');
  });

  it('maps EACCES to permission', () => {
    expect(classifyNodeError(errnoError('EACCES'))).toBe('permission');
  });

  it('maps EPERM to permission', () => {
    expect(classifyNodeError(errnoError('EPERM'))).toBe('permission');
  });

  it('returns null for an unrecognized errno code', () => {
    expect(classifyNodeError(errnoError('ENOENT'))).toBeNull();
  });

  it('returns null for a non-Error value', () => {
    expect(classifyNodeError('not an error')).toBeNull();
  });
});
