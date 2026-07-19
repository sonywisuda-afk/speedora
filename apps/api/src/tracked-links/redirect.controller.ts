import { Controller, Get, Headers, HttpStatus, Ip, NotFoundException, Param, Res, UseGuards } from '@nestjs/common';
import { ThrottlerGuard } from '@nestjs/throttler';
import type { Response } from 'express';
import { RedirectService } from './redirect.service';

// Sprint 6K (Conversion) - deliberately public (no JwtAuthGuard), same
// "public route, does something, then redirects" shape as
// SocialController.callback() (the OAuth callback) - this is a link
// creators share with their own audience, clicked by end users in a
// browser, never by an authenticated app user. ThrottlerGuard here is a
// coarse per-IP backstop against a scripted flood, not the real duplicate-
// click protection (that's RedirectService/ClickDedupService's short
// debounce window) - see this module's own ThrottlerModule registration
// for the actual limit.
@Controller('r')
@UseGuards(ThrottlerGuard)
export class RedirectController {
  constructor(private readonly redirect: RedirectService) {}

  @Get(':slug')
  async handleRedirect(
    @Param('slug') slug: string,
    @Headers('user-agent') userAgent: string | undefined,
    @Headers('referer') referrer: string | undefined,
    @Ip() ip: string,
    @Res() res: Response,
  ): Promise<void> {
    const destinationUrl = await this.redirect.recordClickAndResolve(slug, {
      ip,
      userAgent,
      referrer,
    });
    if (!destinationUrl) {
      // Same "resolve-or-404" convention as ShareController's public
      // token-scoped routes - a genuinely dead/mistyped slug is rare
      // enough that a plain 404 doesn't need a friendlier redirect target.
      throw new NotFoundException('Link not found');
    }
    // 302 (Found / temporary), never 301 - a permanent redirect would let
    // browsers and CDNs cache it and stop hitting this endpoint entirely
    // on repeat clicks from the same client, silently undercounting every
    // click after the first. This IS the load-bearing reason a redirect
    // service can't use 301, not a stylistic choice.
    res.redirect(HttpStatus.FOUND, destinationUrl);
  }
}
