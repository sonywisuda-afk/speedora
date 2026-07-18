import { BadRequestException } from '@nestjs/common';
import { getObjectStream } from '@speedora/storage';
import type { Response } from 'express';
import type { ExportService } from './export.service';
import { ExportController } from './export.controller';

jest.mock('@speedora/storage', () => ({ getObjectStream: jest.fn() }));

describe('ExportController', () => {
  let controller: ExportController;
  let exportService: {
    create: jest.Mock;
    findOwnedOrThrow: jest.Mock;
    findReadyOrThrow: jest.Mock;
    listRecent: jest.Mock;
    toDto: jest.Mock;
  };
  const user = { id: 'user-1', email: 'a@example.com', role: 'CREATOR' as const };

  beforeEach(() => {
    exportService = {
      create: jest.fn(),
      findOwnedOrThrow: jest.fn(),
      findReadyOrThrow: jest.fn(),
      listRecent: jest.fn(),
      toDto: jest.fn(),
    };
    controller = new ExportController(exportService as unknown as ExportService);
    jest.clearAllMocks();
  });

  describe('create', () => {
    it('forwards the requester id and DTO to the service', async () => {
      exportService.create.mockResolvedValue({ id: 'job-1', status: 'PENDING' });

      const result = await controller.create(user, { videoId: 'video-1' });

      expect(exportService.create).toHaveBeenCalledWith('user-1', { videoId: 'video-1' });
      expect(result).toEqual({ id: 'job-1', status: 'PENDING' });
    });
  });

  describe('list', () => {
    it('wraps the service result in a { jobs } envelope', async () => {
      exportService.listRecent.mockResolvedValue([{ id: 'job-1' }, { id: 'job-2' }]);

      const result = await controller.list(user, 'video-1');

      expect(exportService.listRecent).toHaveBeenCalledWith('user-1', {
        videoId: 'video-1',
        type: undefined,
      });
      expect(result).toEqual({ jobs: [{ id: 'job-1' }, { id: 'job-2' }] });
    });

    it('accepts type without videoId, for the account-wide ANALYTICS_REPORT list', async () => {
      exportService.listRecent.mockResolvedValue([{ id: 'job-1' }]);

      const result = await controller.list(user, undefined, 'ANALYTICS_REPORT');

      expect(exportService.listRecent).toHaveBeenCalledWith('user-1', {
        videoId: undefined,
        type: 'ANALYTICS_REPORT',
      });
      expect(result).toEqual({ jobs: [{ id: 'job-1' }] });
    });

    it('throws BadRequestException when neither videoId nor type is given', async () => {
      await expect(controller.list(user, undefined, undefined)).rejects.toThrow(
        BadRequestException,
      );
      expect(exportService.listRecent).not.toHaveBeenCalled();
    });

    it('throws BadRequestException for an invalid type value', async () => {
      await expect(controller.list(user, undefined, 'NOT_A_REAL_TYPE')).rejects.toThrow(
        BadRequestException,
      );
      expect(exportService.listRecent).not.toHaveBeenCalled();
    });
  });

  describe('poll', () => {
    it('returns the DTO for an owned job', async () => {
      const job = { id: 'job-1', userId: 'user-1' };
      exportService.findOwnedOrThrow.mockResolvedValue(job);
      exportService.toDto.mockReturnValue({ id: 'job-1', status: 'PROCESSING' });

      const result = await controller.poll(user, 'job-1');

      expect(exportService.findOwnedOrThrow).toHaveBeenCalledWith('job-1', 'user-1');
      expect(exportService.toDto).toHaveBeenCalledWith(job);
      expect(result).toEqual({ id: 'job-1', status: 'PROCESSING' });
    });

    it('propagates the not-found error from the service', async () => {
      exportService.findOwnedOrThrow.mockRejectedValue(new Error('not found'));

      await expect(controller.poll(user, 'missing')).rejects.toThrow('not found');
    });
  });

  describe('download', () => {
    it('streams a PDF job as an attachment with the video-scoped filename', async () => {
      exportService.findReadyOrThrow.mockResolvedValue({
        id: 'job-1',
        videoId: 'video-1',
        type: 'PDF',
        resultUrl: 'exports/job-1.pdf',
      });
      const fakeStream = { pipe: jest.fn() };
      (getObjectStream as jest.Mock).mockResolvedValue(fakeStream);
      const res = { setHeader: jest.fn() } as unknown as Response;

      await controller.download(user, 'job-1', res);

      expect(exportService.findReadyOrThrow).toHaveBeenCalledWith('job-1', 'user-1');
      expect(getObjectStream).toHaveBeenCalledWith('exports/job-1.pdf');
      expect(res.setHeader).toHaveBeenCalledWith('Content-Type', 'application/pdf');
      expect(res.setHeader).toHaveBeenCalledWith(
        'Content-Disposition',
        'attachment; filename="video-video-1-report.pdf"',
      );
      expect(fakeStream.pipe).toHaveBeenCalledWith(res);
    });

    it('streams an EXCEL job with the spreadsheet content type and .xlsx filename', async () => {
      exportService.findReadyOrThrow.mockResolvedValue({
        id: 'job-1',
        videoId: 'video-1',
        type: 'EXCEL',
        resultUrl: 'exports/job-1.xlsx',
      });
      (getObjectStream as jest.Mock).mockResolvedValue({ pipe: jest.fn() });
      const res = { setHeader: jest.fn() } as unknown as Response;

      await controller.download(user, 'job-1', res);

      expect(res.setHeader).toHaveBeenCalledWith(
        'Content-Type',
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      );
      expect(res.setHeader).toHaveBeenCalledWith(
        'Content-Disposition',
        'attachment; filename="video-video-1-report.xlsx"',
      );
    });

    it('falls back to an analytics-report-scoped filename when the job has no videoId', async () => {
      exportService.findReadyOrThrow.mockResolvedValue({
        id: 'job-1',
        videoId: null,
        type: 'ANALYTICS_REPORT',
        resultUrl: 'exports/job-1.pdf',
      });
      (getObjectStream as jest.Mock).mockResolvedValue({ pipe: jest.fn() });
      const res = { setHeader: jest.fn() } as unknown as Response;

      await controller.download(user, 'job-1', res);

      expect(res.setHeader).toHaveBeenCalledWith(
        'Content-Disposition',
        'attachment; filename="analytics-report-job-1.pdf"',
      );
    });

    it('404s without touching storage when the job is not ready yet', async () => {
      exportService.findReadyOrThrow.mockRejectedValue(new Error('not ready yet'));
      const res = { setHeader: jest.fn() } as unknown as Response;

      await expect(controller.download(user, 'job-1', res)).rejects.toThrow('not ready yet');
      expect(getObjectStream).not.toHaveBeenCalled();
    });
  });
});
