import { SetMetadata } from '@nestjs/common';

export const EMAIL_VERIFIED_KEY = 'requireVerifiedEmail';

// Authentication Foundation Sprint 2 (Account Trust) - mirrors Roles/
// ROLES_KEY exactly. Paired with EmailVerifiedGuard. Not applied to any
// route yet - infrastructure only, ready for a future route to opt in.
export const RequireVerifiedEmail = () => SetMetadata(EMAIL_VERIFIED_KEY, true);
