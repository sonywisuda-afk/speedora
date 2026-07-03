import { ArgumentsHost, Catch, HttpException } from '@nestjs/common';
import { BaseExceptionFilter } from '@nestjs/core';
import * as Sentry from '@sentry/node';

// Registered globally in main.ts. Nest's own exception handling already
// turns thrown errors into HTTP responses without this filter - its only
// job is to also report the unexpected ones to Sentry before delegating to
// the default behavior (super.catch()), which is untouched, so response
// shapes/status codes are identical to before this filter existed.
//
// Expected control-flow exceptions (NotFoundException, BadRequestException,
// etc. - anything a HttpException with a <500 status) are NOT reported:
// those are normal, already-handled outcomes, not bugs worth paging anyone
// over. Only capture the exception object itself - never the request/
// response (which could carry the session cookie/JWT or a request body).
@Catch()
export class SentryExceptionFilter extends BaseExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost): void {
    const isExpectedHttpError = exception instanceof HttpException && exception.getStatus() < 500;
    if (!isExpectedHttpError) {
      Sentry.captureException(exception);
    }
    super.catch(exception, host);
  }
}
