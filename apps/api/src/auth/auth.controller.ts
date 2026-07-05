import { Body, Controller, Delete, Get, HttpCode, Post, Res, UseGuards } from '@nestjs/common';
import { ThrottlerGuard } from '@nestjs/throttler';
import type { Response } from 'express';
import { AuthService, type SafeUser } from './auth.service';
import { CurrentUser } from './decorators/current-user.decorator';
import { ChangePasswordDto } from './dto/change-password.dto';
import { ForgotPasswordDto } from './dto/forgot-password.dto';
import { LoginDto } from './dto/login.dto';
import { RegisterDto } from './dto/register.dto';
import { ResetPasswordDto } from './dto/reset-password.dto';
import { JwtAuthGuard } from './guards/jwt-auth.guard';

const COOKIE_NAME = 'token';
// Kept in sync with the JWT_EXPIRES_IN default (7d, see .env.example). The
// JWT's own expiry is what's actually enforced; this just keeps the browser
// from holding onto an unusable cookie long after that.
const COOKIE_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Post('register')
  async register(@Body() body: RegisterDto, @Res({ passthrough: true }) res: Response) {
    const user = await this.authService.register(body.email, body.password);
    this.setTokenCookie(res, user);
    return user;
  }

  @Post('login')
  @HttpCode(200)
  @UseGuards(ThrottlerGuard)
  async login(@Body() body: LoginDto, @Res({ passthrough: true }) res: Response) {
    const user = await this.authService.validateUser(body.email, body.password);
    this.setTokenCookie(res, user);
    return user;
  }

  @Post('logout')
  @HttpCode(200)
  logout(@Res({ passthrough: true }) res: Response) {
    res.clearCookie(COOKIE_NAME);
    return { success: true };
  }

  @Get('me')
  @UseGuards(JwtAuthGuard)
  me(@CurrentUser() user: SafeUser) {
    return user;
  }

  @Delete('me')
  @HttpCode(204)
  @UseGuards(JwtAuthGuard)
  async deleteAccount(@CurrentUser() user: SafeUser, @Res({ passthrough: true }) res: Response) {
    await this.authService.deleteAccount(user.id);
    // The account is gone - drop the now-useless session cookie too.
    res.clearCookie(COOKIE_NAME);
  }

  @Post('forgot-password')
  @HttpCode(200)
  @UseGuards(ThrottlerGuard)
  async forgotPassword(@Body() body: ForgotPasswordDto) {
    const webOrigin = process.env.WEB_ORIGIN ?? 'http://localhost:3000';
    await this.authService.requestPasswordReset(body.email, webOrigin);
    // Same response whether or not the email matched an account - see
    // AuthService.requestPasswordReset's comment.
    return { message: 'If that email is registered, a reset link has been sent.' };
  }

  @Post('reset-password')
  @HttpCode(200)
  async resetPassword(@Body() body: ResetPasswordDto, @Res({ passthrough: true }) res: Response) {
    const user = await this.authService.resetPassword(body.token, body.newPassword);
    // Auto-login after a successful reset, same as register/login.
    this.setTokenCookie(res, user);
    return user;
  }

  @Post('change-password')
  @HttpCode(200)
  @UseGuards(JwtAuthGuard)
  async changePassword(@Body() body: ChangePasswordDto, @CurrentUser() user: SafeUser) {
    await this.authService.changePassword(user.id, body.currentPassword, body.newPassword);
    return { success: true };
  }

  private setTokenCookie(res: Response, user: SafeUser) {
    const token = this.authService.issueToken(user);
    res.cookie(COOKIE_NAME, token, {
      httpOnly: true,
      sameSite: 'lax',
      secure: process.env.NODE_ENV === 'production',
      maxAge: COOKIE_MAX_AGE_MS,
      path: '/',
    });
  }
}
