import { PLATFORM_METADATA, SocialPlatform } from '@speedora/shared';
import { AtSign, Briefcase, Camera, Music2, Play, Share2, ThumbsUp, type LucideIcon } from 'lucide-react';

// Multi-Platform Publishing Expansion, Phase 0. `@speedora/shared`'s
// PLATFORM_METADATA has no React dependency (just label/iconKey/colorHex) -
// this is where iconKey resolves to an actual lucide-react component. The
// single place to touch when a new platform's icon is picked (Phase 1+),
// instead of the 3 independently hand-copied `PLATFORM_LABELS` maps this
// replaced (social/page.tsx, DashboardClient.tsx, lib/analytics.ts).
// lucide-react (this project's version) has no licensed brand/logo icons
// (Youtube/Instagram/etc. don't exist in its export list) - these are
// generic representative icons, not the platforms' actual logos.
const ICONS: Record<string, LucideIcon> = {
  youtube: Play,
  tiktok: Music2,
  instagram: Camera,
  facebook: ThumbsUp,
  threads: AtSign,
  linkedin: Briefcase,
};

export function platformLabel(platform: SocialPlatform | string): string {
  return PLATFORM_METADATA[platform as SocialPlatform]?.label ?? platform;
}

export function platformColor(platform: SocialPlatform | string): string {
  return PLATFORM_METADATA[platform as SocialPlatform]?.colorHex ?? '#64748b';
}

export function platformIcon(platform: SocialPlatform | string): LucideIcon {
  const iconKey = PLATFORM_METADATA[platform as SocialPlatform]?.iconKey;
  return (iconKey && ICONS[iconKey]) || Share2;
}

export { PLATFORM_METADATA };
