import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { AuthModule } from './auth/auth.module';
import { ClipsModule } from './clips/clips.module';
import { validateEnv } from './config/env.validation';
import { HealthModule } from './health/health.module';
import { PrismaModule } from './prisma/prisma.module';
import { SocialModule } from './social/social.module';
import { VideosModule } from './videos/videos.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: '../../.env',
      // Runs synchronously while this module's imports are being built, so
      // a missing DATABASE_URL/JWT_SECRET/STORAGE_* fails the whole app at
      // boot with a clear message instead of failing later (or silently)
      // once QueueModule/AuthModule/PrismaService actually try to use them.
      validate: validateEnv,
    }),
    PrismaModule,
    AuthModule,
    VideosModule,
    ClipsModule,
    SocialModule,
    HealthModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
