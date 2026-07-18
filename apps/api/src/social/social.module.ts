import { JwtModule } from '@nestjs/jwt';
import { Module } from '@nestjs/common';
import {
  FacebookOAuthClient,
  InstagramOAuthClient,
  LinkedInOAuthClient,
  ThreadsOAuthClient,
  TikTokOAuthClient,
  YouTubeOAuthClient,
} from '@speedora/social';
import { SocialController } from './social.controller';
import { SocialAccountsService } from './social.service';

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
  providers: [
    SocialAccountsService,
    YouTubeOAuthClient,
    TikTokOAuthClient,
    InstagramOAuthClient,
    FacebookOAuthClient,
    ThreadsOAuthClient,
    LinkedInOAuthClient,
  ],
  // ClipsModule (Fase 6b) needs SocialAccountsService.findOwnedOrThrow() to
  // validate the target account before enqueueing a publish-clip job.
  exports: [SocialAccountsService],
})
export class SocialModule {}
