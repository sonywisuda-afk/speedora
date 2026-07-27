import {
  BadRequestException,
  Body,
  Controller,
  Get,
  HttpCode,
  Post,
  Req,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import type { Request } from 'express';
import { AuthService, type SafeUser } from '../auth.service';
import { CurrentUser } from '../decorators/current-user.decorator';
import { JwtAuthGuard } from '../guards/jwt-auth.guard';
import { PrismaService } from '../../prisma/prisma.service';
import { MfaCodeDto } from './dto/mfa-code.dto';
import { MfaService } from './mfa.service';

function userAgentOf(req: Request): string | undefined {
  const value = req.headers['user-agent'];
  return Array.isArray(value) ? value[0] : value;
}

// Tahap 2 Step 2 Sprint 1 (MFA Foundation) - every route here is "an
// already-logged-in user manages their own MFA," mirroring
// OAuthController's own separate-controller precedent rather than bolting
// more routes onto the already-large AuthController. No login-flow route
// lives here yet - that's Sprint 2 (Enforcement).
@Controller('auth/mfa')
@UseGuards(JwtAuthGuard)
export class MfaController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly mfaService: MfaService,
    private readonly authService: AuthService,
  ) {}

  @Get('status')
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

  @Post('disable')
  @HttpCode(200)
  async disable(@CurrentUser() user: SafeUser, @Req() req: Request, @Body() body: MfaCodeDto) {
    const record = await this.prisma.user.findUniqueOrThrow({
      where: { id: user.id },
      select: { mfaEnabled: true, mfaSecret: true },
    });
    if (!record.mfaEnabled || !record.mfaSecret) {
      throw new BadRequestException('MFA is not enabled');
    }

    const verified = await this.mfaService.verifyMfaCodeOrRecoveryCode(
      user.id,
      record.mfaSecret,
      body.code,
    );
    if (!verified) {
      throw new UnauthorizedException('Invalid verification code');
    }

    await this.prisma.$transaction(async (tx) => {
      await tx.user.update({
        where: { id: user.id },
        data: { mfaEnabled: false, mfaSecret: null, mfaEnabledAt: null },
      });
      await tx.mfaRecoveryCode.deleteMany({ where: { userId: user.id } });
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

  @Post('recovery-codes/regenerate')
  @HttpCode(200)
  async regenerateRecoveryCodes(
    @CurrentUser() user: SafeUser,
    @Req() req: Request,
    @Body() body: MfaCodeDto,
  ) {
    const record = await this.prisma.user.findUniqueOrThrow({
      where: { id: user.id },
      select: { mfaEnabled: true, mfaSecret: true },
    });
    if (!record.mfaEnabled || !record.mfaSecret) {
      throw new BadRequestException('MFA is not enabled');
    }

    const verified = await this.mfaService.verifyMfaCodeOrRecoveryCode(
      user.id,
      record.mfaSecret,
      body.code,
    );
    if (!verified) {
      throw new UnauthorizedException('Invalid verification code');
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
}
