'use client';

import { useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { AlertTriangle, RefreshCw } from 'lucide-react';

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error('[Global Error]', error);
  }, [error]);

  return (
    <html lang="en">
      <body className="font-body antialiased">
        <div className="flex h-screen flex-col items-center justify-center gap-4 text-center px-4">
          <AlertTriangle className="size-12 text-red-500" />
          <h2 className="text-2xl font-bold">Application Error</h2>
          <p className="text-gray-500 max-w-md">
            {error.message || 'A critical error occurred. Please refresh the page.'}
          </p>
          <Button onClick={reset} variant="outline" className="gap-2">
            <RefreshCw className="size-4" />
            Try again
          </Button>
        </div>
      </body>
    </html>
  );
}
