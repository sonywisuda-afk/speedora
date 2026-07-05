'use client';

import { useRef, useState } from 'react';
import { UploadCloud } from 'lucide-react';

import { cn } from '@/lib/utils';

const ACCEPTED_FORMATS_LABEL = 'MP4, MOV, WEBM, AVI, atau MKV';
const MAX_SIZE_BYTES = 2 * 1024 * 1024 * 1024;

export function validateVideoFile(file: File): string | null {
  if (!file.type.startsWith('video/')) {
    const ext = file.name.includes('.') ? file.name.split('.').pop()?.toUpperCase() : null;
    const found = ext ? `File .${ext} tidak dikenali sebagai video.` : 'Format file ini tidak dikenali sebagai video.';
    return `${found} Upload video dalam format ${ACCEPTED_FORMATS_LABEL}.`;
  }
  if (file.size > MAX_SIZE_BYTES) {
    const sizeGb = (file.size / 1024 ** 3).toFixed(1);
    return `Video terlalu besar (${sizeGb}GB). Ukuran maksimal 2GB.`;
  }
  return null;
}

export function UploadDropzone({
  onFileAccepted,
  onFileRejected,
}: {
  onFileAccepted: (file: File) => void;
  onFileRejected: (message: string) => void;
}) {
  const [isDragOver, setIsDragOver] = useState(false);
  const dragCounter = useRef(0);
  const inputRef = useRef<HTMLInputElement>(null);

  function handleFiles(files: FileList | null) {
    const file = files?.[0];
    if (!file) return;
    const error = validateVideoFile(file);
    if (error) {
      onFileRejected(error);
      return;
    }
    onFileAccepted(file);
  }

  function handleDragEnter(e: React.DragEvent) {
    e.preventDefault();
    dragCounter.current += 1;
    setIsDragOver(true);
  }

  function handleDragLeave(e: React.DragEvent) {
    e.preventDefault();
    dragCounter.current -= 1;
    if (dragCounter.current <= 0) {
      dragCounter.current = 0;
      setIsDragOver(false);
    }
  }

  function handleDragOver(e: React.DragEvent) {
    e.preventDefault();
  }

  function handleDrop(e: React.DragEvent) {
    e.preventDefault();
    dragCounter.current = 0;
    setIsDragOver(false);
    handleFiles(e.dataTransfer.files);
  }

  return (
    <div
      role="button"
      tabIndex={0}
      aria-label="Upload video"
      onClick={() => inputRef.current?.click()}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') inputRef.current?.click();
      }}
      onDragEnter={handleDragEnter}
      onDragLeave={handleDragLeave}
      onDragOver={handleDragOver}
      onDrop={handleDrop}
      className={cn(
        'flex min-h-80 cursor-pointer flex-col items-center justify-center rounded-lg border-2 border-dashed px-6 py-12 text-center transition-colors',
        isDragOver
          ? 'border-signal-pink bg-signal-pink/5'
          : 'border-border bg-slate-panel hover:border-chrome/40',
      )}
    >
      <input
        ref={inputRef}
        type="file"
        accept="video/*"
        tabIndex={-1}
        aria-hidden="true"
        className="sr-only"
        onChange={(e) => handleFiles(e.target.files)}
      />
      <UploadCloud
        className={cn('h-10 w-10', isDragOver ? 'text-signal-pink' : 'text-chrome')}
        aria-hidden="true"
      />
      <p className="mt-4 font-display text-xl uppercase tracking-wide text-foreground">
        {isDragOver ? 'Lepas untuk Upload' : 'Drag Video ke Sini'}
      </p>
      <p className="mt-1 font-body text-sm text-muted-foreground">
        {isDragOver ? 'Video akan langsung diproses' : 'atau klik untuk pilih dari komputer'}
      </p>
      <p className="mt-6 font-mono text-xs text-muted-foreground">
        {ACCEPTED_FORMATS_LABEL} — maksimal 2GB
      </p>
    </div>
  );
}
