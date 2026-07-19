import { randomBytes } from 'node:crypto';

// Sprint 6K (Conversion) - short (8-char), URL-safe, high-entropy enough
// (randomBytes(6) = 48 bits, ~2.8e14 possible slugs) that a collision is
// vanishingly rare even at high creation volume. The retry loop in
// TrackedLinksService.create() is the real collision guarantee (backed by
// the slug column's own @unique constraint) - this is just "rare enough
// that retrying once or twice is always enough in practice."
const SLUG_BYTES = 6;

export function generateSlug(): string {
  return randomBytes(SLUG_BYTES).toString('base64url');
}
