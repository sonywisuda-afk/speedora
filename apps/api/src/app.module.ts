import { MiddlewareConsumer, Module, type NestModule } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AnalyticsModule } from './analytics/analytics.module';
import { ApprovalsModule } from './approvals/approvals.module';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { AuthModule } from './auth/auth.module';
import { BrandKitModule } from './brand-kit/brand-kit.module';
import { ClipsModule } from './clips/clips.module';
import { CommentsModule } from './comments/comments.module';
import { validateEnv } from './config/env.validation';
import { DashboardModule } from './dashboard/dashboard.module';
import { ExportModule } from './export/export.module';
import { HealthModule } from './health/health.module';
import { MonitoringModule } from './monitoring/monitoring.module';
import { RequestMetricsMiddleware } from './monitoring/request-metrics.middleware';
import { NotificationsModule } from './notifications/notifications.module';
import { OpsAiModule } from './ops-ai/ops-ai.module';
import { PaymentsModule } from './payments/payments.module';
import { PrismaModule } from './prisma/prisma.module';
import { RedisPubSubModule } from './redis-pubsub/redis-pubsub.module';
import { SearchModule } from './search/search.module';
import { ShareModule } from './share/share.module';
import { SocialModule } from './social/social.module';
import { VideosModule } from './videos/videos.module';
import { WorkspaceModule } from './workspace/workspace.module';

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
    RedisPubSubModule,
    AuthModule,
    PaymentsModule,
    VideosModule,
    ClipsModule,
    SocialModule,
    HealthModule,
    MonitoringModule,
    AnalyticsModule,
    OpsAiModule,
    DashboardModule,
    SearchModule,
    WorkspaceModule,
    ShareModule,
    CommentsModule,
    ApprovalsModule,
    ExportModule,
    BrandKitModule,
    NotificationsModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer.apply(RequestMetricsMiddleware).forRoutes('*');
  }
}
