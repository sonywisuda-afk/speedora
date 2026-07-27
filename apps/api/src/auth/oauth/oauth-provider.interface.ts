// Tahap 2 Step 1 (OAuth Login) - unlike packages/social's OAuthConnectAdapter
// (apps/api/src/social/social.controller.ts), this has no `connect(userId,
// ...)` step - login OAuth doesn't know a userId yet when the flow starts
// (that's what resolveOAuthLogin figures out from the profile), and no
// token/refresh methods - once identity is established at login time, the
// provider's own access token is discarded.
export interface OAuthProfile {
  providerAccountId: string;
  email: string;
  name?: string;
}

export interface OAuthLoginAdapter {
  buildAuthorizeUrl(state: string): string;
  exchangeCode(code: string): Promise<{ accessToken: string; idToken?: string }>;
  fetchProfile(tokens: { accessToken: string; idToken?: string }): Promise<OAuthProfile>;
}
