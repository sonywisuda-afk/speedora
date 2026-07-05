import {
  BadRequestException,
  ConflictException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcrypt';
import * as crypto from 'node:crypto';
import { MailService } from '../mail/mail.service';
import { PrismaService } from '../prisma/prisma.service';
import { StorageService } from '../storage/storage.service';

const SALT_ROUNDS = 10;
// Kept short - a live reset link is a bearer credential in email, a medium
// this app doesn't control the security of end-to-end (forwarding,
// shared inboxes, provider-side retention).
const RESET_TOKEN_TTL_MS = 60 * 60 * 1000;

export interface SafeUser {
  id: string;
  email: string;
}

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwtService: JwtService,
    private readonly mailService: MailService,
    private readonly storage: StorageService,
  ) {}

  async register(email: string, password: string): Promise<SafeUser> {
    const existing = await this.prisma.user.findUnique({ where: { email } });
    if (existing) {
      throw new ConflictException('An account with this email already exists');
    }

    const passwordHash = await bcrypt.hash(password, SALT_ROUNDS);
    const user = await this.prisma.user.create({
      data: { email, password: passwordHash },
    });

    return { id: user.id, email: user.email };
  }

  async validateUser(email: string, password: string): Promise<SafeUser> {
    const user = await this.prisma.user.findUnique({ where: { email } });
    if (!user) {
      throw new UnauthorizedException('Invalid email or password');
    }

    const passwordMatches = await bcrypt.compare(password, user.password);
    if (!passwordMatches) {
      throw new UnauthorizedException('Invalid email or password');
    }

    return { id: user.id, email: user.email };
  }

  issueToken(user: SafeUser): string {
    return this.jwtService.sign({ sub: user.id, email: user.email });
  }

  // Silently no-ops on an unknown email - same "don't confirm which emails
  // have an account" reasoning as the identical 404s on video/clip
  // ownership checks elsewhere in this app (see CLAUDE.md). The controller
  // always returns the same generic response regardless of which branch
  // ran here.
  async requestPasswordReset(email: string, webOrigin: string): Promise<void> {
    const user = await this.prisma.user.findUnique({ where: { email } });
    if (!user) {
      return;
    }

    // Raw token only ever exists here and in the emailed link - only its
    // SHA-256 hash is persisted, same reasoning as bcrypt-hashing the login
    // password itself (see the resetPasswordTokenHash field comment in
    // schema.prisma). A new request overwrites the previous hash/expiry,
    // implicitly invalidating any earlier unused reset link.
    const rawToken = crypto.randomBytes(32).toString('hex');
    const tokenHash = crypto.createHash('sha256').update(rawToken).digest('hex');

    await this.prisma.user.update({
      where: { id: user.id },
      data: {
        resetPasswordTokenHash: tokenHash,
        resetPasswordTokenExpiresAt: new Date(Date.now() + RESET_TOKEN_TTL_MS),
      },
    });

    const resetUrl = `${webOrigin}/reset-password?token=${rawToken}`;
    await this.mailService.sendPasswordResetEmail(user.email, resetUrl);
  }

  async resetPassword(token: string, newPassword: string): Promise<SafeUser> {
    const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
    const user = await this.prisma.user.findUnique({
      where: { resetPasswordTokenHash: tokenHash },
    });

    if (
      !user ||
      !user.resetPasswordTokenExpiresAt ||
      user.resetPasswordTokenExpiresAt.getTime() < Date.now()
    ) {
      throw new BadRequestException('Reset link is invalid or has expired');
    }

    const passwordHash = await bcrypt.hash(newPassword, SALT_ROUNDS);
    const updated = await this.prisma.user.update({
      where: { id: user.id },
      data: {
        password: passwordHash,
        resetPasswordTokenHash: null,
        resetPasswordTokenExpiresAt: null,
      },
    });

    return { id: updated.id, email: updated.email };
  }

  async changePassword(
    userId: string,
    currentPassword: string,
    newPassword: string,
  ): Promise<void> {
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId } });

    const passwordMatches = await bcrypt.compare(currentPassword, user.password);
    if (!passwordMatches) {
      throw new UnauthorizedException('Current password is incorrect');
    }

    const passwordHash = await bcrypt.hash(newPassword, SALT_ROUNDS);
    await this.prisma.user.update({ where: { id: user.id }, data: { password: passwordHash } });
  }

  // Permanently deletes the account and everything it owns. The user row's
  // cascades take care of the database (videos -> clips -> publish records,
  // videos -> transcript segments, and social accounts all onDelete:
  // Cascade); storage objects are collected first (since the rows are about
  // to be gone) and cleaned up best-effort afterwards, same as deleting a
  // single video. findUniqueOrThrow gives a clean 404 if the account somehow
  // no longer exists.
  async deleteAccount(userId: string): Promise<void> {
    await this.prisma.user.findUniqueOrThrow({ where: { id: userId } });

    const videos = await this.prisma.video.findMany({
      where: { ownerId: userId },
      select: { sourceUrl: true, clips: { select: { outputUrl: true } } },
    });
    const storageKeys = videos.flatMap((video) => [
      video.sourceUrl,
      ...video.clips.map((clip) => clip.outputUrl ?? ''),
    ]);

    await this.prisma.user.delete({ where: { id: userId } });
    await this.storage.deleteObjects(storageKeys);
  }
}
