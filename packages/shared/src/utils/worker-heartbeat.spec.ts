import { heartbeatKey, heartbeatKeyPattern } from './worker-heartbeat';

describe('heartbeatKey / heartbeatKeyPattern', () => {
  it('namespaces a worker id under the shared prefix', () => {
    expect(heartbeatKey('worker-render')).toBe('speedora:worker:heartbeat:worker-render');
  });

  it('produces distinct keys for distinct worker ids', () => {
    expect(heartbeatKey('worker-a')).not.toBe(heartbeatKey('worker-b'));
  });

  it('produces a pattern that matches every key heartbeatKey() can produce', () => {
    const pattern = heartbeatKeyPattern();
    const regex = new RegExp(`^${pattern.replace('*', '.*')}$`);
    expect(regex.test(heartbeatKey('worker-render'))).toBe(true);
    expect(regex.test(heartbeatKey('worker-light-01'))).toBe(true);
  });

  it('the pattern does not match an unrelated key', () => {
    const pattern = heartbeatKeyPattern();
    const regex = new RegExp(`^${pattern.replace('*', '.*')}$`);
    expect(regex.test('speedora:video-import:total')).toBe(false);
  });
});
