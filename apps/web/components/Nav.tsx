'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import type { UserDto } from '../lib/api';
import { cn } from '../lib/utils';
import { NotificationBell } from './NotificationBell';
import { WorkspaceSwitcher } from './WorkspaceSwitcher';

const LINKS = [
  { href: '/upload', label: 'Upload' },
  { href: '/dashboard', label: 'Dashboard' },
  { href: '/analytics', label: 'Analytics' },
  { href: '/social', label: 'Social Media' },
  { href: '/campaigns', label: 'Campaigns' },
  { href: '/leaderboard', label: 'Leaderboard' },
  { href: '/schedules', label: 'Schedules' },
  { href: '/calendar', label: 'Calendar' },
  { href: '/accounts', label: 'Accounts' },
] as const;

// Milestone 5C-B - shown only for ADMIN/AI_ENGINEER/OPERATOR. Client-side
// visibility only; GET /ops/ai/* enforces the real boundary server-side
// (RolesGuard) regardless of whether this link is visible.
const OPS_AI_LINK = { href: '/ops/ai', label: 'AI Ops' } as const;

export function Nav({ user, onLogout }: { user: UserDto; onLogout: () => void }) {
  const pathname = usePathname();
  const links = user.role === 'CREATOR' ? LINKS : [...LINKS, OPS_AI_LINK];

  return (
    // flex-wrap + gap so the links row and the account row stack instead of
    // overlapping on the narrower pages (upload/accounts), rather than the
    // links colliding with the email as they did before.
    <div className="mt-6 flex flex-wrap items-center justify-between gap-x-6 gap-y-2 border-b border-border pb-3">
      <nav className="flex gap-1 font-body text-sm">
        {links.map((link) => {
          const active = pathname === link.href;
          return (
            <Link
              key={link.href}
              href={link.href}
              aria-current={active ? 'page' : undefined}
              className={cn(
                'rounded-md px-3 py-1.5 transition-colors',
                active
                  ? 'bg-slate-panel font-medium text-signal-pink'
                  : 'text-muted-foreground hover:bg-slate-panel/60 hover:text-foreground',
              )}
            >
              {link.label}
            </Link>
          );
        })}
      </nav>
      <div className="flex items-center gap-3 font-body text-sm">
        <WorkspaceSwitcher />
        <NotificationBell />
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
  );
}
