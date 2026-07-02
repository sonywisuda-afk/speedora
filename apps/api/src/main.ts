import { ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import * as cookieParser from 'cookie-parser';
import helmet from 'helmet';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
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
