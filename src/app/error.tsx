'use client';

import { useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { AlertTriangle, RefreshCw } from 'lucide-react';

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error('[App Error]', error);
  }, [error]);

  return (
    <div className="flex h-[80vh] flex-col items-center justify-center gap-4 text-center px-4">
      <AlertTriangle className="size-12 text-destructive" />
      <h2 className="text-2xl font-bold">Something went wrong</h2>
      <p className="text-muted-foreground max-w-md">
        {error.message || 'An unexpected error occurred. Please try again.'}
      </p>
      <Button onClick={reset} variant="outline" className="gap-2">
        <RefreshCw className="size-4" />
        Try again
      </Button>
    </div>
  );
}
