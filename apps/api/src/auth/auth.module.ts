import { JwtModule } from '@nestjs/jwt';
import { Module } from '@nestjs/common';
import { PassportModule } from '@nestjs/passport';
import { ThrottlerModule } from '@nestjs/throttler';
import { MailModule } from '../mail/mail.module';
import { StorageModule } from '../storage/storage.module';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { CAPTCHA_PROVIDER } from './captcha/captcha-provider.interface';
import { TurnstileCaptchaProvider } from './captcha/turnstile-captcha.provider';
import { LoginBackoffService } from './login-backoff.service';
import { RedisThrottlerStorage } from './redis-throttler-storage.service';
import { JwtStrategy } from './strategies/jwt.strategy';

@Module({
  imports: [
    MailModule,
    StorageModule,
    PassportModule,
    // useFactory defers reading JWT_SECRET/ACCESS_TOKEN_EXPIRES_IN until DI
    // instantiation time, after ConfigModule.forRoot() has loaded the root
    // .env file - see QueueModule for why reading them eagerly here (e.g.
    // via a plain object passed to register()) would be a real bug.
    JwtModule.registerAsync({
      useFactory: () => ({
        secret: process.env.JWT_SECRET,
        // Authentication Foundation Sprint 1 - deliberately short-lived now
        // that a Session-backed refresh token (POST /auth/refresh) exists to
        // renew it; the old 7d default relied on the JWT's own expiry as the
        // only revocation mechanism. @nestjs/jwt types expiresIn as number |
        // ms.StringValue (a branded literal-union type), which a plain
        // env-var string can never satisfy structurally even though
        // jsonwebtoken accepts any valid "ms" duration string at runtime.
        signOptions: { expiresIn: (process.env.ACCESS_TOKEN_EXPIRES_IN ?? '15m') as never },
      }),
    }),
    // Only applied where @UseGuards(ThrottlerGuard) is used (POST
    // /auth/login, POST /auth/forgot-password) - not registered globally,
    // so it has no effect on any other route. storage is Redis-backed
    // (RedisThrottlerStorage) instead of @nestjs/throttler's default
    // in-memory Map, so this 5-attempts-per-minute limit is shared across
    // every apps/api replica rather than being silently multiplied by
    // replica count (each replica used to keep its own independent
    // in-memory counter - fine with one instance, a real gap the moment a
    // second one is added behind a load balancer). forRootAsync (not
    // forRoot) defers constructing RedisThrottlerStorage - and its
    // REDIS_URL read - until DI instantiation time, same reasoning as
    // JwtModule.registerAsync above.
    ThrottlerModule.forRootAsync({
      useFactory: () => ({
        throttlers: [{ name: 'login', ttl: 60_000, limit: 5 }],
        storage: new RedisThrottlerStorage(),
      }),
    }),
  ],
  controllers: [AuthController],
  providers: [
    AuthService,
    JwtStrategy,
    LoginBackoffService,
    // Authentication Foundation Sprint 4 - AuthService/AuthController inject
    // CaptchaProvider via this token, never TurnstileCaptchaProvider
    // directly - swapping providers later means changing only this one
    // binding, see captcha-provider.interface.ts's own comment.
    { provide: CAPTCHA_PROVIDER, useClass: TurnstileCaptchaProvider },
  ],
  exports: [AuthService],
})
export class AuthModule {}
