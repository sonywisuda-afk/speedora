'use client';

import { type FormEvent, useState } from 'react';
import { Link2 } from 'lucide-react';
import { isYoutubeUrl } from '@speedora/shared';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { UploadDropzone } from '@/components/upload/UploadDropzone';

export function ImportTabs({
  onFileAccepted,
  onFileRejected,
  onImport,
  importing,
}: {
  onFileAccepted: (file: File) => void;
  onFileRejected: (message: string) => void;
  onImport: (url: string) => void;
  importing: boolean;
}) {
  const [url, setUrl] = useState('');
  const [urlError, setUrlError] = useState<string | null>(null);

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    const trimmed = url.trim();
    if (!isYoutubeUrl(trimmed)) {
      setUrlError(
        'Link ini bukan video YouTube yang dikenali. Pakai format youtube.com/watch?v=... atau youtu.be/...',
      );
      return;
    }
    setUrlError(null);
    onImport(trimmed);
  }

  return (
    <Tabs defaultValue="file">
      <TabsList>
        <TabsTrigger value="file">Upload Video</TabsTrigger>
        <TabsTrigger value="youtube" className="gap-2">
          <Link2 className="h-3.5 w-3.5" aria-hidden="true" />
          Import dari YouTube
        </TabsTrigger>
      </TabsList>

      <TabsContent value="file">
        <UploadDropzone onFileAccepted={onFileAccepted} onFileRejected={onFileRejected} />
      </TabsContent>

      <TabsContent value="youtube">
        <form
          onSubmit={handleSubmit}
          className="flex min-h-80 flex-col items-center justify-center rounded-lg border-2 border-dashed border-border bg-slate-panel px-6 py-12 text-center"
        >
          <Link2 className="h-10 w-10 text-chrome" aria-hidden="true" />
          <p className="mt-4 font-display text-xl uppercase tracking-wide text-foreground">
            Import dari YouTube
          </p>
          <p className="mt-1 max-w-sm font-body text-sm text-muted-foreground">
            Tempel link video YouTube — video akan diunduh lalu diproses sama seperti upload
            langsung.
          </p>
          <div className="mt-6 flex w-full max-w-sm gap-2">
            <Input
              value={url}
              onChange={(e) => {
                setUrl(e.target.value);
                if (urlError) setUrlError(null);
              }}
              placeholder="https://youtube.com/watch?v=..."
              aria-label="Tautan YouTube"
              aria-invalid={urlError ? true : undefined}
              disabled={importing}
            />
            <Button type="submit" disabled={importing || url.trim().length === 0}>
              {importing ? 'Mengimpor...' : 'Import'}
            </Button>
          </div>
          {urlError ? <p className="mt-2 text-sm text-destructive">{urlError}</p> : null}
        </form>
      </TabsContent>
    </Tabs>
  );
}
