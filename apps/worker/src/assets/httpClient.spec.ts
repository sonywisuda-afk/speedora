const fetchMock = jest.fn();
(global as unknown as { fetch: typeof fetch }).fetch = fetchMock as unknown as typeof fetch;

import { fetchJson, HttpRequestError } from './httpClient';

describe('fetchJson', () => {
  beforeEach(() => {
    fetchMock.mockReset();
  });

  it('returns the parsed JSON body for a successful response', async () => {
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({ hello: 'world' }) });

    const result = await fetchJson('https://example.com/api');

    expect(result).toEqual({ hello: 'world' });
  });

  it('passes headers through to fetch', async () => {
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({}) });

    await fetchJson('https://example.com/api', { headers: { Authorization: 'token' } });

    const [, options] = fetchMock.mock.calls[0];
    expect(options.headers).toEqual({ Authorization: 'token' });
  });

  it('throws HttpRequestError (with the status) for a non-2xx response, without calling .json()', async () => {
    const jsonMock = jest.fn();
    fetchMock.mockResolvedValue({ ok: false, status: 429, json: jsonMock });

    await expect(fetchJson('https://example.com/api')).rejects.toThrow(HttpRequestError);
    await expect(fetchJson('https://example.com/api')).rejects.toMatchObject({ status: 429 });
    expect(jsonMock).not.toHaveBeenCalled();
  });

  it('aborts and rejects once the timeout elapses', async () => {
    fetchMock.mockImplementation(
      (_url: string, options: { signal: AbortSignal }) =>
        new Promise((_resolve, reject) => {
          options.signal.addEventListener('abort', () =>
            reject(new Error('The operation was aborted')),
          );
        }),
    );

    await expect(fetchJson('https://example.com/api', { timeoutMs: 10 })).rejects.toThrow();
  });
});
