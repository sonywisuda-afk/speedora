'use client';

import Link from 'next/link';
import useSWR from 'swr';
import { brandKitLogoUrl, getBrandKit } from '@/lib/api';

// Brand Kit roadmap (P3a) - the Export Center's own tab used to be the only
// place to edit logo/colors (Sprint 03d), which was scope creep from being
// built just for the PDF Brand Report. Editing now lives at the flat
// /brand-kit route (same convention as /campaigns/social/analytics); this
// tab is a read-only summary of what the PDF Brand Report will use, plus a
// link to the real editor - no editing UI duplicated in two places.
export function BrandKitTab() {
  // Workspace-level Brand Kit roadmap (P3g) - always the PERSONAL kit (the
  // Brand Report is a User-scoped export, unaffected by whichever workspace
  // is active elsewhere in the app) - closure fetcher, not the `useSWR(key,
  // fn)` shorthand, since SWR would otherwise call getBrandKit('brand-kit')
  // and misread the cache key itself as a workspaceId.
  const { data: brandKit, isLoading } = useSWR('brand-kit', () => getBrandKit());

  return (
    <div className="space-y-4">
      {isLoading ? null : brandKit ? (
        <div className="flex items-center gap-4">
          {brandKit.logoUrl ? (
            <img
              src={brandKitLogoUrl()}
              crossOrigin="use-credentials"
              alt="Logo brand"
              className="h-14 w-14 rounded-md border border-border bg-muted object-contain"
            />
          ) : (
            <div className="flex h-14 w-14 items-center justify-center rounded-md border border-dashed border-border font-mono text-[10px] text-muted-foreground">
              Kosong
            </div>
          )}
          <div className="space-y-1 font-body text-xs text-muted-foreground">
            <p>
              Warna:{' '}
              {brandKit.primaryColor || brandKit.secondaryColor ? (
                <span className="font-mono">
                  {[brandKit.primaryColor, brandKit.secondaryColor].filter(Boolean).join(' / ')}
                </span>
              ) : (
                'belum diatur'
              )}
            </p>
            <p>Font: {brandKit.fontFamily || 'Default (Inter)'}</p>
          </div>
        </div>
      ) : null}

      <Link
        href="/brand-kit"
        className="inline-block font-body text-sm text-primary underline underline-offset-2"
      >
        Edit di Brand Kit →
      </Link>
    </div>
  );
}
