import { Injectable, Logger } from '@nestjs/common';
import * as nodemailer from 'nodemailer';
import type { Transporter } from 'nodemailer';

let transporter: Transporter | null = null;

// Lazy, same reasoning as packages/storage's getClient() - constructed on
// first use (inside a method call, not at module scope) so a missing
// SMTP_HOST just means "not configured yet" rather than "silently built
// against undefined env vars because this ran before .env loaded".
function getTransporter(): Transporter {
  if (!transporter) {
    transporter = nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port: Number(process.env.SMTP_PORT) || 587,
      secure: process.env.SMTP_SECURE === 'true',
      // Gmail displays App Passwords with spaces for readability
      // (e.g. "abcd efgh ijkl mnop") but rejects the login if those spaces
      // are sent as part of the password - strip all whitespace so a
      // straight copy-paste from Google's UI still works.
      auth:
        process.env.SMTP_USER && process.env.SMTP_PASSWORD
          ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASSWORD.replace(/\s+/g, '') }
          : undefined,
    });
  }
  return transporter;
}

@Injectable()
export class MailService {
  private readonly logger = new Logger(MailService.name);

  // SMTP_* is optional at boot, same posture as SENTRY_DSN/GOOGLE_OAUTH_*/
  // TOKEN_ENCRYPTION_KEY (see env.validation.ts) - most of this app has to
  // keep working for anyone who hasn't set up an SMTP account yet. Instead
  // of failing to send, the reset link is logged so forgot-password is
  // still usable (by reading server logs) in local dev.
  async sendPasswordResetEmail(to: string, resetUrl: string): Promise<void> {
    if (!process.env.SMTP_HOST) {
      this.logger.warn(
        `SMTP_HOST is not configured - password reset email not sent. Reset link for ${to}: ${resetUrl}`,
      );
      return;
    }

    try {
      await getTransporter().sendMail({
        from: process.env.SMTP_FROM ?? 'no-reply@speedora.local',
        to,
        subject: 'Reset your password',
        text: `Click the link below to reset your password. This link expires in 1 hour.\n\n${resetUrl}\n\nIf you didn't request this, you can ignore this email.`,
        html: `<p>Click the link below to reset your password. This link expires in 1 hour.</p><p><a href="${resetUrl}">${resetUrl}</a></p><p>If you didn't request this, you can ignore this email.</p>`,
      });
    } catch (error) {
      // Logged, not rethrown - forgot-password's response is intentionally
      // identical whether or not the email matched an account (see
      // AuthService.requestPasswordReset). Letting an SMTP failure bubble
      // up as a 500 would defeat that: it would tell a caller "this send
      // attempt was actually made" purely by the shape of the error,
      // and would surface a raw error to a user who did nothing wrong.
      this.logger.error(`Failed to send password reset email to ${to}: ${error}`);
    }
  }

  // Authentication Foundation Sprint 2 (Account Trust) - same SMTP-optional
  // posture as sendPasswordResetEmail: a missing SMTP_HOST logs the link
  // instead of failing the request (so registration keeps working in local
  // dev without real SMTP), and a real send failure is logged, not
  // rethrown - AuthController.register()'s response is never blocked on
  // this email actually landing.
  async sendVerificationEmail(to: string, verifyUrl: string): Promise<void> {
    if (!process.env.SMTP_HOST) {
      this.logger.warn(
        `SMTP_HOST is not configured - verification email not sent. Verify link for ${to}: ${verifyUrl}`,
      );
      return;
    }

    try {
      await getTransporter().sendMail({
        from: process.env.SMTP_FROM ?? 'no-reply@speedora.local',
        to,
        subject: 'Verify your email',
        text: `Click the link below to verify your email. This link expires in 24 hours.\n\n${verifyUrl}\n\nIf you didn't create an account, you can ignore this email.`,
        html: `<p>Click the link below to verify your email. This link expires in 24 hours.</p><p><a href="${verifyUrl}">${verifyUrl}</a></p><p>If you didn't create an account, you can ignore this email.</p>`,
      });
    } catch (error) {
      this.logger.error(`Failed to send verification email to ${to}: ${error}`);
    }
  }

  // Sprint 5A (Collaboration Foundation) - replaces sendTeamInviteEmail
  // (Sprint 1-2's one-way "log it" stub). Same SMTP-optional posture as
  // sendPasswordResetEmail: a missing SMTP_HOST logs the invite (including
  // the accept link) instead of failing the request, and a real send
  // failure is logged, not rethrown, since WorkspaceService's own response
  // to the inviter is best-effort - the PendingInvite row and its real
  // accept flow already exist regardless of whether this email lands.
  async sendWorkspaceInviteEmail(
    to: string,
    inviterEmail: string,
    workspaceName: string,
    role: string,
    acceptUrl: string,
  ): Promise<void> {
    if (!process.env.SMTP_HOST) {
      this.logger.warn(
        `SMTP_HOST is not configured - workspace invite email not sent. ` +
          `${inviterEmail} invited ${to} to "${workspaceName}" as ${role}. Accept link: ${acceptUrl}`,
      );
      return;
    }

    try {
      await getTransporter().sendMail({
        from: process.env.SMTP_FROM ?? 'no-reply@speedora.local',
        to,
        subject: `${inviterEmail} invited you to "${workspaceName}" on Speedora`,
        text: `${inviterEmail} invited you to join "${workspaceName}" on Speedora as ${role}.\n\nAccept the invite: ${acceptUrl}`,
        html: `<p>${inviterEmail} invited you to join <strong>${workspaceName}</strong> on Speedora as <strong>${role}</strong>.</p><p><a href="${acceptUrl}">Accept the invite</a></p>`,
      });
    } catch (error) {
      this.logger.error(`Failed to send workspace invite email to ${to}: ${error}`);
    }
  }
}
