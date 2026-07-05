import { AlertTriangle } from 'lucide-react';

import { Button } from '@/components/ui/button';

export function UploadErrorPanel({
  message,
  onRetry,
  onChooseAnother,
}: {
  message: string;
  /** Omitted for validation errors, where there's nothing to retry - only a new file fixes it. */
  onRetry?: () => void;
  onChooseAnother: () => void;
}) {
  return (
    <div className="rounded-lg border border-destructive bg-slate-panel p-6">
      <div className="flex items-start gap-3">
        <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-destructive" aria-hidden="true" />
        <div>
          <p className="font-display text-lg uppercase tracking-wide text-foreground">
            Upload Gagal
          </p>
          <p className="mt-1 font-body text-sm text-muted-foreground">{message}</p>
        </div>
      </div>
      <div className="mt-5 flex flex-wrap gap-3">
        {onRetry ? (
          <Button size="sm" onClick={onRetry}>
            Coba Lagi
          </Button>
        ) : null}
        <Button size="sm" variant="outline" onClick={onChooseAnother}>
          Pilih Video Lain
        </Button>
      </div>
    </div>
  );
}
