import Link from 'next/link';

import { Button } from '@/components/ui/button';

export function ClosingCta() {
  return (
    <div className="text-center">
      <h2 className="mx-auto max-w-2xl font-display text-4xl uppercase leading-tight tracking-wide text-foreground">
        Rekaman Panjang Kamu Sudah Penuh Momen Bagus.
      </h2>
      <p className="mx-auto mt-4 max-w-xl font-body text-muted-foreground">
        Tinggal upload — sisanya biar sistem yang cari, potong, dan siapkan captionnya.
      </p>
      <div className="mt-8">
        <Button size="lg" asChild>
          <Link href="/upload">Upload Video Sekarang</Link>
        </Button>
      </div>
    </div>
  );
}
