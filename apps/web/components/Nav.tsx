'use client';

import Link from 'next/link';
import type { UserDto } from '../lib/api';

export function Nav({ user, onLogout }: { user: UserDto; onLogout: () => void }) {
  return (
    <div className="mt-6 flex items-center justify-between">
      <nav className="flex gap-4 text-sm">
        <Link href="/" className="underline">
          Upload
        </Link>
        <Link href="/dashboard" className="underline">
          Dashboard
        </Link>
      </nav>
      <div className="flex items-center gap-4">
        <p className="text-sm text-neutral-600">
          Signed in as <span className="font-medium">{user.email}</span>
        </p>
        <button onClick={onLogout} className="text-sm text-neutral-600 underline">
          Log out
        </button>
      </div>
    </div>
  );
}
