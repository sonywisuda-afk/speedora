import { BadRequestException } from '@nestjs/common';

const captureExceptionMock = jest.fn();
jest.mock('@sentry/node', () => ({
  captureException: (...args: unknown[]) => captureExceptionMock(...args),
}));

const baseCatchMock = jest.fn();
jest.mock('@nestjs/core', () => ({
  BaseExceptionFilter: class {
    catch(...args: unknown[]) {
      return baseCatchMock(...args);
    }
  },
}));

import { SentryExceptionFilter } from './sentry-exception.filter';

describe('SentryExceptionFilter', () => {
  const host = { fake: 'host' } as never;

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('reports an unexpected (non-HttpException) error to Sentry and still delegates to the base handler', () => {
    const filter = new SentryExceptionFilter();
    const error = new Error('boom');

    filter.catch(error, host);

    expect(captureExceptionMock).toHaveBeenCalledWith(error);
    expect(baseCatchMock).toHaveBeenCalledWith(error, host);
  });

  it('reports a 500-level HttpException to Sentry', () => {
    const filter = new SentryExceptionFilter();
    const error = new BadRequestException('bad'); // stand-in, status overridden below
    jest.spyOn(error, 'getStatus').mockReturnValue(500);

    filter.catch(error, host);

    expect(captureExceptionMock).toHaveBeenCalledWith(error);
    expect(baseCatchMock).toHaveBeenCalledWith(error, host);
  });

  it('does not report an expected (<500) HttpException to Sentry', () => {
    const filter = new SentryExceptionFilter();
    const error = new BadRequestException('bad input');

    filter.catch(error, host);

    expect(captureExceptionMock).not.toHaveBeenCalled();
    expect(baseCatchMock).toHaveBeenCalledWith(error, host);
  });
});
