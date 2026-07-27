import { DEFAULT_PROCESSING_OPTIONS } from '@speedora/shared';
import type { ProcessingPresetsService } from './processing-presets.service';
import { ProcessingPresetsController } from './processing-presets.controller';

describe('ProcessingPresetsController', () => {
  let controller: ProcessingPresetsController;
  let processingPresets: {
    create: jest.Mock;
    list: jest.Mock;
    update: jest.Mock;
    remove: jest.Mock;
  };
  const user = { id: 'user-1', email: 'a@example.com', role: 'CREATOR' as const, emailVerified: true };

  beforeEach(() => {
    processingPresets = {
      create: jest.fn(),
      list: jest.fn(),
      update: jest.fn(),
      remove: jest.fn(),
    };
    controller = new ProcessingPresetsController(
      processingPresets as unknown as ProcessingPresetsService,
    );
  });

  describe('create', () => {
    it('forwards the requester id and DTO', async () => {
      const dto = { name: 'My Preset', config: DEFAULT_PROCESSING_OPTIONS };
      processingPresets.create.mockResolvedValue({ id: 'preset-1', ...dto });

      await controller.create(user, dto);

      expect(processingPresets.create).toHaveBeenCalledWith('user-1', dto);
    });
  });

  describe('list', () => {
    it('delegates to the service scoped to the requester', async () => {
      processingPresets.list.mockResolvedValue({ presets: [] });

      const result = await controller.list(user);

      expect(processingPresets.list).toHaveBeenCalledWith('user-1');
      expect(result).toEqual({ presets: [] });
    });
  });

  describe('update', () => {
    it('forwards the requester id, preset id, and DTO', async () => {
      processingPresets.update.mockResolvedValue({ id: 'preset-1', name: 'Renamed' });

      await controller.update(user, 'preset-1', { name: 'Renamed' });

      expect(processingPresets.update).toHaveBeenCalledWith('user-1', 'preset-1', {
        name: 'Renamed',
      });
    });
  });

  describe('remove', () => {
    it('forwards the requester id and preset id', async () => {
      await controller.remove(user, 'preset-1');

      expect(processingPresets.remove).toHaveBeenCalledWith('user-1', 'preset-1');
    });
  });
});
