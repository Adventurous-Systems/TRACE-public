import type { Metadata } from 'next';
import './globals.css';
import { Toaster } from '@/components/ui/toaster';
import { Analytics } from '@/components/Analytics';

export const metadata: Metadata = {
  title: 'TRACE — Material Passport Platform',
  description: 'Blockchain-enabled digital marketplace for construction material reuse',
  manifest: '/manifest.json',
};

export const viewport = {
  themeColor: '#16a34a',
  width: 'device-width',
  initialScale: 1,
};

export const dynamic = 'force-dynamic';

export default function RootLayout({ children }: { children: React.ReactNode }) {
  // Read at request time (this layout is force-dynamic). Runtime-only vars — NOT
  // NEXT_PUBLIC_* — because the Docker image is built before .env is mounted, so a
  // NEXT_PUBLIC_ value would be inlined as undefined. We pass the id as a prop to a
  // client component instead.
  const umamiWebsiteId = process.env.UMAMI_WEBSITE_ID;
  const umamiEnabled = process.env.UMAMI_ENABLED !== 'false';
  const configuredProfile = process.env.TRACE_DEPLOYMENT_PROFILE;
  const deploymentProfile =
    configuredProfile === 'public_showcase' || configuredProfile === 'public_sandbox'
      ? configuredProfile
      : 'self_hosted';

  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link
          href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap"
          rel="stylesheet"
        />
      </head>
      <body
        className="font-sans antialiased overflow-x-clip"
        data-deployment-profile={deploymentProfile}
      >
        <div className="trace-showcase-only border-b border-amber-200 bg-amber-50 px-4 py-2 text-center text-sm text-amber-900">
          Public research showcase — synthetic data and read-only interactions.
        </div>
        {children}
        <Toaster />
        {umamiEnabled && umamiWebsiteId ? <Analytics websiteId={umamiWebsiteId} /> : null}
      </body>
    </html>
  );
}
