import { compareVersions, evaluateHealthStatus } from './health';

describe('compareVersions', () => {
  it('orders date-formatted versions lexicographically', () => {
    expect(compareVersions('2025.06.30', '2024.12.06')).toBe(1);
    expect(compareVersions('2024.12.06', '2025.06.30')).toBe(-1);
    expect(compareVersions('2025.06.30', '2025.06.30')).toBe(0);
  });
});

describe('evaluateHealthStatus', () => {
  it('is unreachable when there is no version', () => {
    expect(evaluateHealthStatus(null, '2024.01.01')).toBe('unreachable');
  });

  it('is healthy when no minimum is configured', () => {
    expect(evaluateHealthStatus('2020.01.01', null)).toBe('healthy');
  });

  it('is healthy when the version meets the minimum', () => {
    expect(evaluateHealthStatus('2025.06.30', '2024.01.01')).toBe('healthy');
  });

  it('is stale when the version is older than the minimum', () => {
    expect(evaluateHealthStatus('2023.01.01', '2024.01.01')).toBe('stale');
  });
});
