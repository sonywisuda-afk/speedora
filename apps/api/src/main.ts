import { ValidationPipe } from '@nestjs/common';
import { HttpAdapterHost, NestFactory } from '@nestjs/core';
import * as cookieParser from 'cookie-parser';
import helmet from 'helmet';
import { AppModule } from './app.module';
import { initSentry } from './sentry';
import { SentryExceptionFilter } from './sentry-exception.filter';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  // After NestFactory.create() (ConfigModule has loaded .env into
  // process.env by now), before anything starts handling requests.
  initSentry();
  // BaseExceptionFilter needs the underlying httpAdapter itself (it calls
  // methods like isHeadersSent() on it directly) - NOT the HttpAdapterHost
  // wrapper object, which only exposes it via .httpAdapter.
  const { httpAdapter } = app.get(HttpAdapterHost);
  app.useGlobalFilters(new SentryExceptionFilter(httpAdapter));

  app.use(helmet());
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
  app.use(cookieParser());
  app.enableCors({
    origin: process.env.WEB_ORIGIN ?? 'http://localhost:3000',
    credentials: true,
    // GET /videos/:id/source (timeline editor <video> preview) responds
    // with these for Range requests; harmless to expose them on every
    // response.
    exposedHeaders: ['Content-Range', 'Content-Length', 'Accept-Ranges'],
  });
  await app.listen(process.env.API_PORT ?? 3001);
}
bootstrap();
