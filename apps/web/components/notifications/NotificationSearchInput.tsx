'use client';

import { Search } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Input } from '@/components/ui/input';

const DEBOUNCE_MS = 300;

// Same debounce convention as components/dashboard/SearchBar.tsx - local
// input state updates on every keystroke (instant visual feedback), the
// actual filter callback (which drives a real API call) only fires after
// the user pauses typing.
export function NotificationSearchInput({
  value,
  onChange,
}: {
  value: string;
  onChange: (query: string) => void;
}) {
  const [draft, setDraft] = useState(value);

  useEffect(() => {
    const timer = setTimeout(() => {
      if (draft !== value) onChange(draft);
    }, DEBOUNCE_MS);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draft]);

  return (
    <div className="relative">
      <Search
        className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
        aria-hidden="true"
      />
      <Input
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        placeholder="Cari notifikasi (judul, isi, video)..."
        className="pl-9"
        type="search"
        aria-label="Cari notifikasi"
        autoComplete="off"
        autoCorrect="off"
        autoCapitalize="off"
        spellCheck={false}
      />
    </div>
  );
}
