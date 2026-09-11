'use client';

import { useEffect, useRef, useState } from 'react';
import type { Html5Qrcode as Html5QrcodeInstance } from 'html5-qrcode';
import { useRouter } from 'next/navigation';

// Dynamically import html5-qrcode to avoid SSR issues

export default function QrScanner() {
  const router = useRouter();
  const scannerRef = useRef<Html5QrcodeInstance | null>(null);
  const [status, setStatus] = useState<'idle' | 'starting' | 'scanning' | 'error'>('idle');
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<string | null>(null);

  useEffect(() => {
    let mounted = true;

    async function startScanner() {
      setStatus('starting');
      try {
        const { Html5Qrcode } = await import('html5-qrcode');

        if (!mounted) return;

        const scanner = new Html5Qrcode('qr-reader');
        scannerRef.current = scanner;

        await scanner.start(
          { facingMode: 'environment' },
          { fps: 10, qrbox: { width: 250, height: 250 } },
          (decodedText) => {
            if (!mounted) return;
            setResult(decodedText);
            setStatus('idle');
            scanner.stop().catch(() => null);

            // Try to extract a passport ID from the URL
            // Expected format: https://.../passport/<uuid>
            try {
              const url = new URL(decodedText);
              const segments = url.pathname.split('/').filter(Boolean);
              const passportIdx = segments.indexOf('passport');
              if (passportIdx !== -1 && segments[passportIdx + 1]) {
                router.push(`/passport/${segments[passportIdx + 1]}`);
              } else {
                // Fall back to navigating to the raw URL path
                router.push(url.pathname);
              }
            } catch {
              // Not a URL — display the raw result
            }
          },
          () => {
            // Scan in progress — ignore decode errors
          },
        );
        if (mounted) setStatus('scanning');
      } catch (err) {
        if (mounted) {
          setStatus('error');
          setError(err instanceof Error ? err.message : 'Camera access denied');
        }
      }
    }

    startScanner();

    return () => {
      mounted = false;
      scannerRef.current?.stop().catch(() => null);
    };
  }, [router]);

  return (
    <div className="w-full max-w-sm">
      <div
        id="qr-reader"
        className="rounded-2xl overflow-hidden border-4 border-brand-500"
        style={{ width: '100%' }}
      />

      {status === 'starting' && (
        <p className="text-gray-300 text-sm text-center mt-4">Starting camera…</p>
      )}

      {status === 'scanning' && (
        <p className="text-gray-300 text-sm text-center mt-4">Hold steady over the QR code</p>
      )}

      {status === 'error' && (
        <div className="bg-red-900/50 rounded-xl p-4 mt-4 text-center">
          <p className="text-red-300 text-sm">{error}</p>
          <p className="text-gray-400 text-xs mt-1">
            Make sure camera permissions are granted in your browser settings.
          </p>
        </div>
      )}

      {result && (
        <div className="bg-white/10 rounded-xl p-4 mt-4 text-center">
          <p className="text-white text-sm font-medium">Scanned:</p>
          <p className="text-gray-300 text-xs break-all mt-1">{result}</p>
          <p className="text-gray-400 text-xs mt-2">Redirecting…</p>
        </div>
      )}

      <p className="text-gray-500 text-xs text-center mt-6">Or enter a passport ID manually:</p>
      <ManualEntry />
    </div>
  );
}

function ManualEntry() {
  const router = useRouter();
  const [id, setId] = useState('');

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = id.trim();
    if (trimmed) router.push(`/passport/${trimmed}`);
  }

  return (
    <form onSubmit={handleSubmit} className="flex gap-2 mt-2">
      <input
        type="text"
        placeholder="Passport ID or URL"
        value={id}
        onChange={(e) => setId(e.target.value)}
        className="flex-1 rounded-lg border border-gray-600 bg-gray-800 text-white px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500 placeholder:text-gray-500"
      />
      <button
        type="submit"
        className="bg-brand-600 hover:bg-brand-700 text-white px-4 py-2 rounded-lg text-sm font-medium"
      >
        Go
      </button>
    </form>
  );
}
