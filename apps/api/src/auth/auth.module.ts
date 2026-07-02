import { JwtModule } from '@nestjs/jwt';
import { Module } from '@nestjs/common';
import { PassportModule } from '@nestjs/passport';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { JwtStrategy } from './strategies/jwt.strategy';

@Module({
  imports: [
    PassportModule,
    // useFactory defers reading JWT_SECRET/JWT_EXPIRES_IN until DI
    // instantiation time, after ConfigModule.forRoot() has loaded the root
    // .env file - see QueueModule for why reading them eagerly here (e.g.
    // via a plain object passed to register()) would be a real bug.
    JwtModule.registerAsync({
      useFactory: () => ({
        secret: process.env.JWT_SECRET,
        // @nestjs/jwt types expiresIn as number | ms.StringValue (a branded
        // literal-union type), which a plain env-var string can never
        // satisfy structurally even though jsonwebtoken accepts any valid
        // "ms" duration string at runtime.
        signOptions: { expiresIn: (process.env.JWT_EXPIRES_IN ?? '7d') as never },
      }),
    }),
  ],
  controllers: [AuthController],
  providers: [AuthService, JwtStrategy],
  exports: [AuthService],
})
export class AuthModule {}
