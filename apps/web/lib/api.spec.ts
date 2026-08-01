import { ElevationRequiredError, parseJsonOrThrow } from './api';

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
    await expect(parseJsonOrThrow(jsonResponse(404, { message: 'Project not found' }))).rejects.toThrow(
      'Project not found',
    );
  });

  it('falls back to a generic message when `message` is neither a string nor an array', async () => {
    await expect(parseJsonOrThrow(jsonResponse(500, { message: { unexpected: true } }))).rejects.toThrow(
      'Request failed',
    );
  });

  it('still throws ElevationRequiredError with a joined message', async () => {
    await expect(
      parseJsonOrThrow(
        jsonResponse(403, { elevationRequired: true, message: ['recent verification required'] }),
      ),
    ).rejects.toThrow(ElevationRequiredError);
  });

  it('resolves with the parsed body on a successful response', async () => {
    await expect(parseJsonOrThrow(jsonResponse(200, { id: 'abc' }))).resolves.toEqual({ id: 'abc' });
  });
});
