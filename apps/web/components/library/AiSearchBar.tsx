'use client';

import { useState } from 'react';
import type { ParseClipQueryResult } from '@/lib/api';
import { parseClipQuery } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

export interface AiSearchBarProps {
  workspaceId?: string;
  onResult: (result: ParseClipQueryResult) => void;
}

// Natural Language AI Search roadmap (P4) - self-contained input/loading/
// error state, same "component owns its own request state" shape as
// SearchBar.tsx. Deliberately renders no results itself - success just
// calls onResult, and the parent (the Clip Library page) merges the
// returned filters into the SAME state its manual ClipLibraryFilters
// controls already write to. Errors degrade to "just use the manual
// filters" rather than breaking the page - a rate-limit (400) or
// not-configured (503) response both just show inline, nothing crashes.
export function AiSearchBar({ workspaceId, onResult }: AiSearchBarProps) {
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = query.trim();
    if (!trimmed || loading) return;
    setLoading(true);
    setError(null);
    try {
      const result = await parseClipQuery(trimmed, { workspaceId });
      onResult(result);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Pencarian AI tidak tersedia saat ini');
    } finally {
      setLoading(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-1.5">
      <div className="flex items-center gap-2">
        <Input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder='Cari dengan AI, contoh: "klip terbaik di bawah 30 detik tentang marketing"'
          className="h-9 w-full max-w-md"
          disabled={loading}
        />
        <Button type="submit" size="sm" variant="outline" disabled={loading || !query.trim()}>
          {loading ? 'Mencari...' : 'Cari dengan AI'}
        </Button>
      </div>
      {error && <p className="font-body text-xs text-destructive">{error}</p>}
    </form>
  );
}
