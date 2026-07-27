'use client';

import { X } from 'lucide-react';
import { useToastStore } from '@/lib/toast-store';
import { cn } from '@/lib/utils';

// Notification Center Sprint 4A - mounted once in app/layout.tsx, sibling
// to {children}. Styled consistent with Badge's tone tokens
// (good/neutral/bad), same convention ExportTypeRow/ActivityTimeline use.
const TONE_CLASSES: Record<'good' | 'neutral' | 'bad', string> = {
  good: 'border-success/40',
  neutral: 'border-border',
  bad: 'border-destructive/40',
};

export function Toaster() {
  const toasts = useToastStore((state) => state.toasts);
  const dismiss = useToastStore((state) => state.dismiss);

  if (toasts.length === 0) return null;

  return (
    <div className="pointer-events-none fixed bottom-4 right-4 z-50 flex w-full max-w-sm flex-col gap-2">
      {toasts.map((item) => (
        <div
          key={item.id}
          role="status"
          className={cn(
            'pointer-events-auto flex items-start gap-3 rounded-md border bg-card px-4 py-3 shadow-lg',
            TONE_CLASSES[item.tone],
          )}
        >
          <div className="flex-1">
            <p className="font-body text-sm font-medium text-foreground">{item.title}</p>
            {item.description && (
              <p className="mt-0.5 font-body text-xs text-muted-foreground">{item.description}</p>
            )}
          </div>
          <button
            onClick={() => dismiss(item.id)}
            aria-label="Tutup notifikasi"
            className="text-muted-foreground hover:text-foreground"
          >
            <X className="h-4 w-4" aria-hidden="true" />
          </button>
        </div>
      ))}
    </div>
  );
}
