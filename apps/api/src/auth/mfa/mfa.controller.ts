import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Post,
  Req,
  Res,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import { ThrottlerGuard } from '@nestjs/throttler';
import type { Request, Response } from 'express';
import { setAuthCookies, setTrustedDeviceCookie } from '../auth-cookies.util';
import { AuthService, type SafeUser } from '../auth.service';
import { CurrentUser } from '../decorators/current-user.decorator';
import { RequireRecentMfa } from '../decorators/require-recent-mfa.decorator';
import { JwtAuthGuard } from '../guards/jwt-auth.guard';
import { RecentMfaGuard } from '../guards/recent-mfa.guard';
import { PrismaService } from '../../prisma/prisma.service';
import { MfaChallengeDto } from './dto/mfa-challenge.dto';
import { MfaCodeDto } from './dto/mfa-code.dto';
import { MfaService } from './mfa.service';

function userAgentOf(req: Request): string | undefined {
  const value = req.headers['user-agent'];
  return Array.isArray(value) ? value[0] : value;
}

// Tahap 2 Step 2 Sprint 1/2a (MFA Foundation/Enforcement) - most routes here
// are "an already-logged-in user manages their own MFA" (JwtAuthGuard on
// each of those individually, not at the class level any more), mirroring
// OAuthController's own separate-controller precedent rather than bolting
// more routes onto the already-large AuthController. `challenge` below is
// the one deliberate exception - unauthenticated by definition, same
// posture as AuthController.login itself (nobody has a session yet; that's
// exactly what a successful challenge produces).
@Controller('auth/mfa')
export class MfaController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly mfaService: MfaService,
    private readonly authService: AuthService,
  ) {}

  @Get('status')
  @UseGuards(JwtAuthGuard)
  async status(@CurrentUser() user: SafeUser) {
    const record = await this.prisma.user.findUniqueOrThrow({
      where: { id: user.id },
      select: { mfaEnabled: true, mfaEnabledAt: true },
    });
    const recoveryCodesRemaining = record.mfaEnabled
      ? await this.prisma.mfaRecoveryCode.count({ where: { userId: user.id, usedAt: null } })
      : 0;
    return {
      enabled: record.mfaEnabled,
      enabledAt: record.mfaEnabledAt,
      recoveryCodesRemaining,
    };
  }

  // Saves a fresh secret immediately (mfaEnabled stays false until
  // /enroll/confirm succeeds) - an abandoned enrollment is just silently
  // overwritten by the next call here, no cleanup needed. Re-enrolling
  // while already enabled is allowed (regenerates the secret; the account
  // stays protected under the OLD secret/mfaEnabled=true until confirm
  // succeeds against the new one) - confirm is what actually switches over.
  @Post('enroll')
  @UseGuards(JwtAuthGuard)
  async enroll(@CurrentUser() user: SafeUser) {
    const secret = this.mfaService.generateSecret();
    await this.prisma.user.update({
      where: { id: user.id },
      data: { mfaSecret: this.mfaService.encryptSecret(secret) },
    });

    const otpAuthUrl = this.mfaService.buildOtpAuthUrl(user.email, secret);
    const qrCodeDataUrl = await this.mfaService.generateQrCodeDataUrl(otpAuthUrl);
    return { secret, qrCodeDataUrl };
  }

  @Post('enroll/confirm')
  @HttpCode(200)
  @UseGuards(JwtAuthGuard)
  async confirmEnroll(
    @CurrentUser() user: SafeUser,
    @Req() req: Request,
    @Body() body: MfaCodeDto,
  ) {
    const record = await this.prisma.user.findUniqueOrThrow({
      where: { id: user.id },
      select: { mfaSecret: true },
    });
    if (!record.mfaSecret) {
      throw new BadRequestException('No MFA enrollment in progress - call /auth/mfa/enroll first');
    }

    const secret = this.mfaService.decryptSecret(record.mfaSecret);
    if (!this.mfaService.verifyTotpCode(secret, body.code)) {
      throw new UnauthorizedException('Invalid verification code');
    }

    const recoveryCodes = this.mfaService.generateRecoveryCodes();
    await this.prisma.$transaction(async (tx) => {
      await tx.user.update({
        where: { id: user.id },
        data: { mfaEnabled: true, mfaEnabledAt: new Date() },
      });
      await tx.mfaRecoveryCode.deleteMany({ where: { userId: user.id } });
      await tx.mfaRecoveryCode.createMany({
        data: recoveryCodes.map((code) => ({
          userId: user.id,
          codeHash: this.mfaService.hashRecoveryCode(code),
        })),
      });
    });

    await this.authService.recordSecurityEvent({
      userId: user.id,
      email: user.email,
      eventType: 'MFA_ENABLED',
      ipAddress: req.ip,
      userAgent: userAgentOf(req),
    });

    return { recoveryCodes };
  }

  // Tahap 2 Step 2 Sprint 2b (Session Elevation) - no longer takes/checks a
  // code of its own: RecentMfaGuard already proved recent identity via
  // POST /auth/elevate (a code or the current password, whichever applies
  // to the account).
  @Post('disable')
  @HttpCode(200)
  @UseGuards(JwtAuthGuard, RecentMfaGuard)
  @RequireRecentMfa()
  async disable(@CurrentUser() user: SafeUser, @Req() req: Request) {
    const record = await this.prisma.user.findUniqueOrThrow({
      where: { id: user.id },
      select: { mfaEnabled: true, mfaSecret: true },
    });
    if (!record.mfaEnabled || !record.mfaSecret) {
      throw new BadRequestException('MFA is not enabled');
    }

    await this.prisma.$transaction(async (tx) => {
      await tx.user.update({
        where: { id: user.id },
        data: { mfaEnabled: false, mfaSecret: null, mfaEnabledAt: null },
      });
      await tx.mfaRecoveryCode.deleteMany({ where: { userId: user.id } });
      // A trusted-device grant only makes sense for the enrollment it was
      // created under - re-enabling MFA later starts a fresh secret/
      // recovery-codes cycle, and any device trusted under the old cycle
      // shouldn't silently skip the challenge for it.
      await tx.trustedDevice.updateMany({
        where: { userId: user.id, revokedAt: null },
        data: { revokedAt: new Date() },
      });
    });

    await this.authService.recordSecurityEvent({
      userId: user.id,
      email: user.email,
      eventType: 'MFA_DISABLED',
      ipAddress: req.ip,
      userAgent: userAgentOf(req),
    });

    return { success: true };
  }

  // Tahap 2 Step 2 Sprint 2b (Session Elevation) - same "no code of its own,
  // RecentMfaGuard already proved it" posture as disable above.
  @Post('recovery-codes/regenerate')
  @HttpCode(200)
  @UseGuards(JwtAuthGuard, RecentMfaGuard)
  @RequireRecentMfa()
  async regenerateRecoveryCodes(@CurrentUser() user: SafeUser, @Req() req: Request) {
    const record = await this.prisma.user.findUniqueOrThrow({
      where: { id: user.id },
      select: { mfaEnabled: true, mfaSecret: true },
    });
    if (!record.mfaEnabled || !record.mfaSecret) {
      throw new BadRequestException('MFA is not enabled');
    }

    const recoveryCodes = this.mfaService.generateRecoveryCodes();
    await this.prisma.$transaction(async (tx) => {
      await tx.mfaRecoveryCode.deleteMany({ where: { userId: user.id } });
      await tx.mfaRecoveryCode.createMany({
        data: recoveryCodes.map((code) => ({
          userId: user.id,
          codeHash: this.mfaService.hashRecoveryCode(code),
        })),
      });
    });

    await this.authService.recordSecurityEvent({
      userId: user.id,
      email: user.email,
      eventType: 'MFA_RECOVERY_CODES_REGENERATED',
      ipAddress: req.ip,
      userAgent: userAgentOf(req),
    });

    return { recoveryCodes };
  }

  // Tahap 2 Step 2 Sprint 2a (MFA Enforcement) - completes a login that
  // AuthController.login()/OAuthController.callback() deferred because the
  // account has MFA enabled and no valid low-risk trusted-device cookie was
  // present. Unauthenticated by definition (mirrors POST /auth/login's own
  // posture) - mfaToken (not a session) is what proves "this request
  // belongs to a login attempt that already passed the credential check."
  // Same ThrottlerGuard as /auth/login, to blunt 6-digit-code brute forcing.
  @Post('challenge')
  @HttpCode(200)
  @UseGuards(ThrottlerGuard)
  async challenge(
    @Body() body: MfaChallengeDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const userId = this.authService.verifyMfaChallengeToken(body.mfaToken);
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId } });
    const ipAddress = req.ip;
    const userAgent = userAgentOf(req);

    const codeVerified =
      user.mfaSecret &&
      (await this.mfaService.verifyMfaCodeOrRecoveryCode(user.id, user.mfaSecret, body.code));
    if (!codeVerified) {
      await this.authService.recordSecurityEvent({
        userId: user.id,
        email: user.email,
        eventType: 'LOGIN_FAILED',
        ipAddress,
        userAgent,
        metadata: { reason: 'invalid_mfa_code' },
      });
      throw new UnauthorizedException('Invalid verification code');
    }

    await this.authService.recordSecurityEvent({
      userId: user.id,
      email: user.email,
      eventType: 'LOGIN_SUCCESS',
      ipAddress,
      userAgent,
      metadata: { mfaVerified: true },
    });

    const safeUser: SafeUser = {
      id: user.id,
      email: user.email,
      role: user.role,
      emailVerified: user.emailVerified,
    };
    const tokens = await this.authService.createSession(safeUser, userAgent, ipAddress);
    setAuthCookies(res, tokens);

    if (body.rememberDevice) {
      const trustedDevice = await this.authService.createTrustedDevice(
        user.id,
        userAgent,
        ipAddress,
      );
      setTrustedDeviceCookie(res, trustedDevice.rawToken, trustedDevice.expiresAt);
    }

    return safeUser;
  }

  @Get('trusted-devices')
  @UseGuards(JwtAuthGuard)
  async listTrustedDevices(@CurrentUser() user: SafeUser) {
    return this.authService.listTrustedDevices(user.id);
  }

  @Delete('trusted-devices/:id')
  @HttpCode(204)
  @UseGuards(JwtAuthGuard)
  async revokeTrustedDevice(@CurrentUser() user: SafeUser, @Param('id') id: string) {
    await this.authService.revokeTrustedDeviceById(user.id, id);
  }
}
