// Internal to packages/social (not exported via index.ts) - shared by
// linkedin-oauth.client.ts, linkedin-upload.client.ts, and
// linkedin-stats.client.ts. LinkedIn's REST API requires a
// `Linkedin-Version: YYYYMM` header on every call (distinct from Meta's
// Graph API versioning scheme) - bump LINKEDIN_API_VERSION periodically as
// LinkedIn deprecates old versions.
export const LINKEDIN_API_VERSION = '202607';
export const LINKEDIN_REST_BASE_URL = 'https://api.linkedin.com/rest';
export const LINKEDIN_OAUTH_AUTHORIZE_URL = 'https://www.linkedin.com/oauth/v2/authorization';
export const LINKEDIN_OAUTH_TOKEN_URL = 'https://www.linkedin.com/oauth/v2/accessToken';
export const LINKEDIN_USERINFO_URL = 'https://api.linkedin.com/v2/userinfo';

export function linkedinRestHeaders(accessToken: string): Record<string, string> {
  return {
    Authorization: `Bearer ${accessToken}`,
    'Linkedin-Version': LINKEDIN_API_VERSION,
    'X-Restli-Protocol-Version': '2.0.0',
  };
}
