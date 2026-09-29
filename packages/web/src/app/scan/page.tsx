import Link from 'next/link';
import QrScanner from '@/components/passport/QrScanner';

export const metadata = { title: 'Scan QR — TRACE' };

export default function ScanPage() {
  return (
    <div className="relative min-h-screen bg-gray-900 flex flex-col items-center justify-center px-4">
      <Link
        href="/marketplace"
        className="absolute left-4 top-14 text-sm text-gray-300 hover:text-white"
      >
        ← Marketplace
      </Link>
      <div className="text-white text-center mb-8">
        <img src="/trace-logo-white.png" alt="TRACE" className="mx-auto h-16 w-16 mb-4" />
        <h1 className="text-2xl font-bold">Scan material QR</h1>
        <p className="text-gray-400 text-sm mt-1">Point your camera at a TRACE material QR code</p>
      </div>
      <QrScanner />
    </div>
  );
}
