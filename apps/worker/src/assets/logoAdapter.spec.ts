const fetchJsonMock = jest.fn();
jest.mock('./httpClient', () => ({
  fetchJson: (...args: unknown[]) => fetchJsonMock(...args),
}));

import { LogoAdapter } from './logoAdapter';

describe('LogoAdapter', () => {
  const adapter = new LogoAdapter();

  afterEach(() => {
    fetchJsonMock.mockReset();
  });

  it('has the name "clearbit"', () => {
    expect(adapter.name).toBe('clearbit');
  });

  it('needs no API key - calls fetchJson unconditionally', async () => {
    fetchJsonMock.mockResolvedValue([]);

    await adapter.search('OpenAI');

    expect(fetchJsonMock).toHaveBeenCalledTimes(1);
  });

  it('maps the first suggestion to a StockAsset', async () => {
    fetchJsonMock.mockResolvedValue([
      { name: 'OpenAI', domain: 'openai.com', logo: 'https://logo.clearbit.com/openai.com' },
      {
        name: 'OpenAI Foundation',
        domain: 'openai.org',
        logo: 'https://logo.clearbit.com/openai.org',
      },
    ]);

    const asset = await adapter.search('OpenAI');

    expect(asset).toEqual({
      id: 'clearbit-openai.com',
      url: 'https://logo.clearbit.com/openai.com',
      thumbnail: 'https://logo.clearbit.com/openai.com',
      sourceName: 'clearbit',
      resolution: { width: 512, height: 512 },
      type: 'image',
    });
    const [url] = fetchJsonMock.mock.calls[0];
    expect(url).toContain('query=OpenAI');
  });

  it('returns null when there are no suggestions', async () => {
    fetchJsonMock.mockResolvedValue([]);
    expect(await adapter.search('a very obscure query')).toBeNull();
  });

  it('returns null when the top suggestion has no logo field', async () => {
    fetchJsonMock.mockResolvedValue([{ name: 'X', domain: 'x.com' }]);
    expect(await adapter.search('X')).toBeNull();
  });

  it('lets a fetchJson error (rate limit, network failure, etc.) propagate', async () => {
    fetchJsonMock.mockRejectedValue(new Error('rate limited'));
    await expect(adapter.search('OpenAI')).rejects.toThrow('rate limited');
  });
});
