'use client';

import * as DialogPrimitive from '@radix-ui/react-dialog';
import { Menu, X } from 'lucide-react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useState } from 'react';
import type { UserDto } from '../lib/api';
import { cn } from '../lib/utils';
import { NotificationBell } from './NotificationBell';
import { WorkspaceSwitcher } from './WorkspaceSwitcher';
import { Button } from './ui/button';
import { ThemeToggle } from './ui/theme-toggle';

const LINKS = [
  { href: '/upload', label: 'Upload' },
  { href: '/dashboard', label: 'Dashboard' },
  { href: '/notifications', label: 'Notifications' },
  { href: '/library', label: 'Clip Library' },
  { href: '/projects', label: 'Projects' },
  { href: '/analytics', label: 'Analytics' },
  { href: '/social', label: 'Social Media' },
  { href: '/campaigns', label: 'Campaigns' },
  { href: '/brand-kit', label: 'Brand Kit' },
  { href: '/leaderboard', label: 'Leaderboard' },
  { href: '/schedules', label: 'Schedules' },
  { href: '/calendar', label: 'Calendar' },
  { href: '/accounts', label: 'Accounts' },
] as const;

// Milestone 5C-B - shown only for ADMIN/AI_ENGINEER/OPERATOR. Client-side
// visibility only; GET /ops/ai/* enforces the real boundary server-side
// (RolesGuard) regardless of whether this link is visible.
const OPS_AI_LINK = { href: '/ops/ai', label: 'AI Ops' } as const;

type NavLinkItem = { href: string; label: string };

// Cross-cutting nav hardening pass - this app has no sidebar, only this one
// flat top bar reused across every page (~23 call sites + DashboardClient).
// Below `lg` there was previously no collapse at all: 13-14 links plus the
// whole account cluster just wrapped individually, turning into a tall stack
// of single-item rows on phone widths before any page content appeared. The
// links/account cluster now move into a drawer on narrower screens instead;
// nothing is removed, just relocated behind the trigger button.
function NavLink({
  href,
  label,
  active,
  onClick,
  className,
}: NavLinkItem & { active: boolean; onClick?: () => void; className?: string }) {
  return (
    <Link
      href={href}
      aria-current={active ? 'page' : undefined}
      onClick={onClick}
      className={cn(
        'rounded-md transition-colors',
        active
          ? 'bg-primary-surface font-medium text-primary'
          : 'text-muted-foreground hover:bg-accent hover:text-foreground',
        className,
      )}
    >
      {label}
    </Link>
  );
}

function MobileNavDrawer({
  open,
  onOpenChange,
  links,
  pathname,
  user,
  onLogout,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  links: readonly NavLinkItem[];
  pathname: string;
  user: UserDto;
  onLogout: () => void;
}) {
  const close = () => onOpenChange(false);

  return (
    <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-slate-950/50 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0" />
        {/* Radix Dialog.Content gives this a real focus trap, Escape-to-close,
            overlay-click-to-close, and body scroll lock for free - the same
            primitive every other dialog in this app already relies on. */}
        <DialogPrimitive.Content
          id="mobile-nav-drawer"
          className="fixed inset-y-0 left-0 z-50 flex h-full w-[85vw] max-w-xs flex-col gap-4 overflow-y-auto border-r border-border bg-card p-4 shadow-dialog duration-200 data-[state=closed]:animate-out data-[state=open]:animate-in data-[state=closed]:slide-out-to-left data-[state=open]:slide-in-from-left"
        >
          <div className="flex items-center justify-between">
            <DialogPrimitive.Title className="font-display text-sm uppercase tracking-wide text-foreground">
              Menu
            </DialogPrimitive.Title>
            <DialogPrimitive.Close
              className="rounded-md p-1.5 text-muted-foreground hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              aria-label="Tutup menu navigasi"
            >
              <X className="h-4 w-4" aria-hidden="true" />
            </DialogPrimitive.Close>
          </div>

          <nav aria-label="Navigasi utama" className="flex flex-col gap-1 font-body text-sm">
            {links.map((link) => (
              <NavLink
                key={link.href}
                href={link.href}
                label={link.label}
                active={pathname === link.href}
                onClick={close}
                className="px-3 py-2"
              />
            ))}
          </nav>

          <div className="mt-auto flex flex-col items-start gap-3 border-t border-border pt-4 font-body text-sm">
            <WorkspaceSwitcher />
            <span className="text-muted-foreground">
              Signed in as <span className="font-medium text-foreground">{user.email}</span>
            </span>
            <button
              onClick={() => {
                close();
                onLogout();
              }}
              className="rounded-md px-2 py-1.5 text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
            >
              Log out
            </button>
          </div>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}

export function Nav({ user, onLogout }: { user: UserDto; onLogout: () => void }) {
  const pathname = usePathname();
  const links = user.role === 'CREATOR' ? LINKS : [...LINKS, OPS_AI_LINK];
  const [mobileOpen, setMobileOpen] = useState(false);

  // A route change means navigation succeeded - closes the drawer
  // automatically for the (rare) navigation paths that don't already go
  // through NavLink's onClick, e.g. browser back/forward.
  useEffect(() => {
    setMobileOpen(false);
  }, [pathname]);

  return (
    <div className="mt-6 border-b border-border pb-3">
      <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-2">
        <div className="flex min-w-0 items-center gap-2">
          <Button
            variant="ghost"
            size="icon"
            className="lg:hidden"
            aria-label={mobileOpen ? 'Tutup menu navigasi' : 'Buka menu navigasi'}
            aria-expanded={mobileOpen}
            aria-controls="mobile-nav-drawer"
            onClick={() => setMobileOpen(true)}
          >
            <Menu className="h-5 w-5" aria-hidden="true" />
          </Button>
          {/* Below `lg` there's no room for 13+ links plus the account
              cluster without an unreadable multi-row stack - they move into
              the drawer above instead of wrapping in place. */}
          <nav
            aria-label="Navigasi utama"
            className="hidden flex-wrap gap-1 font-body text-sm lg:flex"
          >
            {links.map((link) => (
              <NavLink
                key={link.href}
                href={link.href}
                label={link.label}
                active={pathname === link.href}
                className="px-3 py-1.5"
              />
            ))}
          </nav>
        </div>

        <div className="flex items-center gap-3 font-body text-sm">
          <div className="hidden lg:block">
            <WorkspaceSwitcher />
          </div>
          <NotificationBell />
          <ThemeToggle />
          <div className="hidden items-center gap-3 lg:flex">
            <span className="text-muted-foreground">
              <span className="hidden sm:inline">Signed in as </span>
              {/* Truncate so a long email can't blow out the row on narrow
                  widths (the cause of the old cramped/overlapping nav). */}
              <span className="max-w-[12rem] truncate align-bottom font-medium text-foreground sm:max-w-[18rem] inline-block">
                {user.email}
              </span>
            </span>
            <button
              onClick={onLogout}
              className="whitespace-nowrap rounded-md px-2 py-1.5 text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
            >
              Log out
            </button>
          </div>
        </div>
      </div>

      <MobileNavDrawer
        open={mobileOpen}
        onOpenChange={setMobileOpen}
        links={links}
        pathname={pathname}
        user={user}
        onLogout={onLogout}
      />
    </div>
  );
}
