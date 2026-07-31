import { deleteWorkspace, leaveWorkspace } from './api';

// Workspace Lifecycle Management roadmap - deleteWorkspace()/leaveWorkspace()
// hand-parse the response body themselves (same pattern as deleteProject/
// removeWorkspaceMember, not parseJsonOrThrow) specifically so the caller's
// error surfaces the backend's own business-rule message (e.g. "This
// workspace still contains projects. Remove or move them first.") rather
// than a generic "Request failed" or the bare HTTP status - that message is
// what the Danger Zone dialogs render to the user. This locks that contract
// in at the fetch-wrapper level, independent of any particular dialog's UI.
describe('deleteWorkspace', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('resolves without throwing on a 204 No Content', async () => {
    jest.spyOn(global, 'fetch').mockResolvedValue({ ok: true } as Response);

    await expect(deleteWorkspace('ws-1')).resolves.toBeUndefined();
  });

  it('throws with the backend-provided message, not just the status code, on a 409 conflict', async () => {
    jest.spyOn(global, 'fetch').mockResolvedValue({
      ok: false,
      status: 409,
      statusText: 'Conflict',
      json: () =>
        Promise.resolve({
          message: 'This workspace still contains projects. Remove or move them first.',
          error: 'Conflict',
          statusCode: 409,
        }),
    } as Response);

    await expect(deleteWorkspace('ws-1')).rejects.toThrow(
      'This workspace still contains projects. Remove or move them first.',
    );
  });

  it('falls back to statusText when the response has no JSON body', async () => {
    jest.spyOn(global, 'fetch').mockResolvedValue({
      ok: false,
      status: 500,
      statusText: 'Internal Server Error',
      json: () => Promise.reject(new Error('not json')),
    } as unknown as Response);

    await expect(deleteWorkspace('ws-1')).rejects.toThrow('Internal Server Error');
  });
});

describe('leaveWorkspace', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('resolves without throwing on a 204 No Content', async () => {
    jest.spyOn(global, 'fetch').mockResolvedValue({ ok: true } as Response);

    await expect(leaveWorkspace('ws-1')).resolves.toBeUndefined();
  });

  it('throws with the backend-provided message on a 400 (owner cannot leave)', async () => {
    jest.spyOn(global, 'fetch').mockResolvedValue({
      ok: false,
      status: 400,
      statusText: 'Bad Request',
      json: () =>
        Promise.resolve({
          message: 'The workspace owner cannot leave - transfer ownership to another member first',
          error: 'Bad Request',
          statusCode: 400,
        }),
    } as Response);

    await expect(leaveWorkspace('ws-1')).rejects.toThrow(
      'The workspace owner cannot leave - transfer ownership to another member first',
    );
  });
});
