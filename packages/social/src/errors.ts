// Framework-agnostic (this package has no NestJS dependency, since
// apps/worker also uses it) - callers that need an HTTP-specific response
// (e.g. apps/api's SocialController returning 503) catch this and
// translate it themselves.
export class OAuthNotConfiguredError extends Error {
  constructor(message = 'YouTube integration is not configured') {
    super(message);
    this.name = 'OAuthNotConfiguredError';
  }
}
