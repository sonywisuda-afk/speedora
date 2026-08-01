import { CaptionStyle } from '@speedora/database';
import type { SubtitlePresetsService } from './subtitle-presets.service';
import { SubtitlePresetsController } from './subtitle-presets.controller';

describe('SubtitlePresetsController', () => {
  let controller: SubtitlePresetsController;
  let subtitlePresets: {
    create: jest.Mock;
    list: jest.Mock;
    update: jest.Mock;
    remove: jest.Mock;
  };
  const user = {
    id: 'user-1',
    email: 'a@example.com',
    role: 'CREATOR' as const,
    emailVerified: true,
  };

  beforeEach(() => {
    subtitlePresets = {
      create: jest.fn(),
      list: jest.fn(),
      update: jest.fn(),
      remove: jest.fn(),
    };
    controller = new SubtitlePresetsController(
      subtitlePresets as unknown as SubtitlePresetsService,
    );
  });

  describe('create', () => {
    it('forwards the requester id and DTO', async () => {
      const dto = {
        name: 'My Karaoke',
        captionStyle: CaptionStyle.KARAOKE,
        speakerColorCaptions: true,
        fontFamily: 'Poppins',
      };
      subtitlePresets.create.mockResolvedValue({ id: 'preset-1', ...dto });

      await controller.create(user, dto);

      expect(subtitlePresets.create).toHaveBeenCalledWith('user-1', dto);
    });
  });

  describe('list', () => {
    it('delegates to the service scoped to the requester', async () => {
      subtitlePresets.list.mockResolvedValue({ presets: [] });

      const result = await controller.list(user);

      expect(subtitlePresets.list).toHaveBeenCalledWith('user-1');
      expect(result).toEqual({ presets: [] });
    });
  });

  describe('update', () => {
    it('forwards the requester id, preset id, and DTO', async () => {
      subtitlePresets.update.mockResolvedValue({ id: 'preset-1', name: 'Renamed' });

      await controller.update(user, 'preset-1', { name: 'Renamed' });

      expect(subtitlePresets.update).toHaveBeenCalledWith('user-1', 'preset-1', {
        name: 'Renamed',
      });
    });
  });

  describe('remove', () => {
    it('forwards the requester id and preset id', async () => {
      await controller.remove(user, 'preset-1');

      expect(subtitlePresets.remove).toHaveBeenCalledWith('user-1', 'preset-1');
    });
  });
});
