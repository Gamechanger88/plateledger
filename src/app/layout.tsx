import type { Metadata } from 'next';
import './globals.css';
import { Toaster } from "@/components/ui/toaster"
import { FirebaseClientProvider } from '@/firebase/client-provider';
import { RestaurantShell } from '@/components/restaurant-shell';
import { MainLayout } from '@/components/main-layout';
import { RestaurantProvider } from '@/contexts/restaurant-context'
import { DateProvider } from '@/contexts/date-context';

export const metadata: Metadata = {
  title: 'Plate Ledger | Restaurant Financial Tool',
  description: 'Manage restaurant revenue, parties, and expenses with ease.',
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800;900&display=swap" rel="stylesheet" />
      </head>
      <body className="font-body antialiased">
        <FirebaseClientProvider>
          <RestaurantProvider>
            <DateProvider>
              <RestaurantShell>
                <MainLayout>
                  {children}
                </MainLayout>
              </RestaurantShell>
            </DateProvider>
          </RestaurantProvider>
          <Toaster />
        </FirebaseClientProvider>
      </body>
    </html>
  );
}
