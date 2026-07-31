import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import type { Request } from 'express';
import { AuthService, type SafeUser } from '../auth.service';
import { CurrentUser } from '../decorators/current-user.decorator';
import { RequireRecentMfa } from '../decorators/require-recent-mfa.decorator';
import { JwtAuthGuard } from '../guards/jwt-auth.guard';
import { RecentMfaGuard } from '../guards/recent-mfa.guard';
import { RenamePasskeyDto } from './dto/rename-passkey.dto';
import { VerifyPasskeyRegistrationDto } from './dto/verify-registration.dto';
import { PasskeyService } from './passkey.service';

// Same helper as auth.controller.ts's/oauth.controller.ts's userAgentOf,
// duplicated rather than exported since it's a one-liner and importing
// across controllers for this alone isn't worth the coupling (same
// reasoning oauth.controller.ts's own copy already documents).
function userAgentOf(req: Request): string | undefined {
  const value = req.headers['user-agent'];
  return Array.isArray(value) ? value[0] : value;
}

// Tahap 3 Sprint 1 (Passkey Foundation) - "Passkeys" section on the Accounts
// page, mirroring OAuthController's own separate-controller precedent
// (rather than bolting more routes onto AuthController/MfaController). Every
// route requires an existing session (JwtAuthGuard) - registering/managing a
// passkey is something an ALREADY-authenticated user does, exactly like MFA
// enrollment. There is no login-with-passkey route here - see
// passkey.service.ts's header comment; that's Sprint 2.
@Controller('auth/passkeys')
@UseGuards(JwtAuthGuard)
export class PasskeyController {
  constructor(
    private readonly passkeyService: PasskeyService,
    private readonly authService: AuthService,
  ) {}

  @Get()
  async list(@CurrentUser() user: SafeUser) {
    return this.passkeyService.list(user.id);
  }

  @Post('register/options')
  async registerOptions(@CurrentUser() user: SafeUser) {
    return this.passkeyService.generateRegistrationOptionsFor(user.id, user.email);
  }

  // Adding a new credential to the account is sensitive enough to warrant
  // the same step-up as OAuth unlink/MFA disable (RecentMfaGuard), not just
  // the ceremony's own challenge token - a stolen access token alone
  // shouldn't be able to plant a persistent, attacker-controlled sign-in
  // credential on the victim's account.
  @Post('register/verify')
  @HttpCode(201)
  @UseGuards(RecentMfaGuard)
  @RequireRecentMfa()
  async registerVerify(
    @CurrentUser() user: SafeUser,
    @Body() body: VerifyPasskeyRegistrationDto,
    @Req() req: Request,
  ) {
    const passkey = await this.passkeyService.verifyAndSaveRegistration(
      user.id,
      body.response,
      body.challengeToken,
      body.name,
    );
    await this.authService.recordSecurityEvent({
      userId: user.id,
      email: user.email,
      eventType: 'PASSKEY_ADDED',
      ipAddress: req.ip,
      userAgent: userAgentOf(req),
      metadata: { passkeyId: passkey.id, deviceType: passkey.deviceType },
    });
    return passkey;
  }

  @Patch(':id')
  async rename(
    @CurrentUser() user: SafeUser,
    @Param('id') id: string,
    @Body() body: RenamePasskeyDto,
  ) {
    return this.passkeyService.rename(user.id, id, body.name);
  }

  @Delete(':id')
  @HttpCode(204)
  @UseGuards(RecentMfaGuard)
  @RequireRecentMfa()
  async delete(@CurrentUser() user: SafeUser, @Param('id') id: string, @Req() req: Request) {
    await this.passkeyService.delete(user.id, id);
    await this.authService.recordSecurityEvent({
      userId: user.id,
      email: user.email,
      eventType: 'PASSKEY_REMOVED',
      ipAddress: req.ip,
      userAgent: userAgentOf(req),
      metadata: { passkeyId: id },
    });
  }
}
