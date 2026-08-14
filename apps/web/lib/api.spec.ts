import { ElevationRequiredError, me, parseJsonOrThrow } from './api';

function jsonResponse(status: number, body: unknown): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: 'Error',
    json: async () => body,
  } as Response;
}

// QA pass finding (Dashboard Improvement Sprint Phase A checklist): NestJS's
// global ValidationPipe always returns `message` as a string[] on a DTO
// validation failure (even a single violation, e.g. a project name over 80
// chars) - this was silently swallowed into a generic "Request failed"
// because only `typeof message === 'string'` was handled.
describe('parseJsonOrThrow', () => {
  it('joins an array validation message into a readable string', async () => {
    await expect(
      parseJsonOrThrow(
        jsonResponse(400, {
          statusCode: 400,
          message: ['name must be shorter than or equal to 80 characters'],
          error: 'Bad Request',
        }),
      ),
    ).rejects.toThrow('name must be shorter than or equal to 80 characters');
  });

  it('joins multiple validation messages with a comma', async () => {
    await expect(
      parseJsonOrThrow(jsonResponse(400, { message: ['field a invalid', 'field b invalid'] })),
    ).rejects.toThrow('field a invalid, field b invalid');
  });

  it('still passes through a plain string message unchanged', async () => {
    await expect(
      parseJsonOrThrow(jsonResponse(404, { message: 'Project not found' })),
    ).rejects.toThrow('Project not found');
  });

  it('falls back to a generic message when `message` is neither a string nor an array', async () => {
    await expect(
      parseJsonOrThrow(jsonResponse(500, { message: { unexpected: true } })),
    ).rejects.toThrow('Request failed');
  });

  it('still throws ElevationRequiredError with a joined message', async () => {
    await expect(
      parseJsonOrThrow(
        jsonResponse(403, { elevationRequired: true, message: ['recent verification required'] }),
      ),
    ).rejects.toThrow(ElevationRequiredError);
  });

  it('resolves with the parsed body on a successful response', async () => {
    await expect(parseJsonOrThrow(jsonResponse(200, { id: 'abc' }))).resolves.toEqual({
      id: 'abc',
    });
  });
});

// Reliability fix (2026-08) - the actual root cause of the
// "(mode polling - koneksi real-time terputus)" banner: apiFetch never
// recovered from an expired 15m access-token cookie, since nothing ever
// called POST /auth/refresh. me() is the exercise surface here since
// apiFetch itself isn't exported - it's a thin enough wrapper (one 401
// special-case, see api.ts) that these assertions are really about apiFetch's
// retry behavior, not me()'s own logic.
describe('apiFetch silent-refresh-and-retry on 401 (exercised via me())', () => {
  const user = { id: 'u1', email: 'a@b.com', role: 'CREATOR', emailVerified: true };
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it('refreshes once and retries the original request on a 401', async () => {
    const fetchMock = jest
      .fn()
      .mockResolvedValueOnce(jsonResponse(401, { message: 'Unauthorized' })) // GET /auth/me
      .mockResolvedValueOnce(jsonResponse(200, { success: true })) // POST /auth/refresh
      .mockResolvedValueOnce(jsonResponse(200, user)); // retried GET /auth/me
    global.fetch = fetchMock as unknown as typeof fetch;

    await expect(me()).resolves.toEqual(user);

    expect(fetchMock).toHaveBeenCalledTimes(3);
    const [refreshUrl, refreshInit] = fetchMock.mock.calls[1];
    expect(String(refreshUrl)).toContain('/auth/refresh');
    expect(refreshInit).toMatchObject({ method: 'POST' });
  });

  it('falls back to the original 401 when refresh itself fails, without retrying again', async () => {
    const fetchMock = jest
      .fn()
      .mockResolvedValueOnce(jsonResponse(401, { message: 'Unauthorized' })) // GET /auth/me
      .mockResolvedValueOnce(
        jsonResponse(401, { message: 'Refresh token is invalid or has expired' }),
      ); // POST /auth/refresh
    global.fetch = fetchMock as unknown as typeof fetch;

    await expect(me()).resolves.toBeNull();

    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('dedupes two concurrent 401s into a single POST /auth/refresh', async () => {
    const fetchMock = jest
      .fn()
      .mockResolvedValueOnce(jsonResponse(401, {})) // me() call A
      .mockResolvedValueOnce(jsonResponse(401, {})) // me() call B
      .mockResolvedValueOnce(jsonResponse(200, { success: true })) // shared refresh
      .mockResolvedValueOnce(jsonResponse(200, user)) // retried A
      .mockResolvedValueOnce(jsonResponse(200, user)); // retried B
    global.fetch = fetchMock as unknown as typeof fetch;

    const [a, b] = await Promise.all([me(), me()]);

    expect(a).toEqual(user);
    expect(b).toEqual(user);
    const refreshCalls = fetchMock.mock.calls.filter(([url]: [unknown]) =>
      String(url).includes('/auth/refresh'),
    );
    expect(refreshCalls).toHaveLength(1);
  });
});
