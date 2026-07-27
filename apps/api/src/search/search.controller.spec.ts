import type { SearchService } from './search.service';
import { SearchController } from './search.controller';

describe('SearchController', () => {
  let controller: SearchController;
  let searchService: { search: jest.Mock };
  const user = { id: 'user-1', email: 'a@example.com', role: 'CREATOR' as const, emailVerified: true };

  beforeEach(() => {
    searchService = { search: jest.fn() };
    controller = new SearchController(searchService as unknown as SearchService);
  });

  it('delegates to SearchService.search with the requesting user and query', async () => {
    const results = { videos: [], clips: [], transcriptMatches: [] };
    searchService.search.mockResolvedValue(results);

    const result = await controller.search(user, 'hello');

    expect(searchService.search).toHaveBeenCalledWith('user-1', 'hello');
    expect(result).toBe(results);
  });

  it('passes an empty string when no query param is given, instead of undefined', async () => {
    await controller.search(user, undefined);

    expect(searchService.search).toHaveBeenCalledWith('user-1', '');
  });
});
