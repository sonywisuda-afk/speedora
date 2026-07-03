import { JwtModule } from '@nestjs/jwt';
import { Module } from '@nestjs/common';
import { SocialController } from './social.controller';
import { SocialAccountsService } from './social.service';
import { YouTubeOAuthClient } from './youtube-oauth.client';

@Module({
  imports: [
    // A separate JwtModule instance from AuthModule's own (not exported
    // from there, and this one needs a different, much shorter expiry) -
    // same JWT_SECRET, used only to sign/verify the OAuth `state` param
    // (see SocialController.connect/.callback), never session tokens.
    JwtModule.registerAsync({
      useFactory: () => ({
        secret: process.env.JWT_SECRET,
        signOptions: { expiresIn: '10m' },
      }),
    }),
  ],
  controllers: [SocialController],
  providers: [SocialAccountsService, YouTubeOAuthClient],
})
export class SocialModule {}
