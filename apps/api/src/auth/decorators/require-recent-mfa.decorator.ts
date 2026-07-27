import { SetMetadata } from '@nestjs/common';

export const RECENT_MFA_KEY = 'requireRecentMfa';

// Tahap 2 Step 2 Sprint 2b (Session Elevation) - mirrors RequireVerifiedEmail/
// EMAIL_VERIFIED_KEY exactly. Paired with RecentMfaGuard. Gates disable-MFA,
// regenerate-recovery-codes, change-password, and delete-account behind a
// fresh POST /auth/elevate within the last ELEVATION_WINDOW_MS.
export const RequireRecentMfa = () => SetMetadata(RECENT_MFA_KEY, true);
