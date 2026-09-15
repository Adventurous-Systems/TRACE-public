import Link from 'next/link';
import { ScrollText, ShieldCheck, Recycle, QrCode, Store } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Logo } from '@/components/ui/Logo';

export default function HomePage() {
  return (
    <main className="min-h-screen bg-gradient-to-b from-brand-50 to-white">
      <nav className="flex items-center justify-between px-4 sm:px-6 py-4 max-w-7xl mx-auto">
        <Link href="/" className="flex items-center" aria-label="TRACE home">
          <Logo className="h-8" />
        </Link>
        <div className="flex items-center gap-1 sm:gap-3">
          <Link href="/marketplace" className="hidden sm:block">
            <Button variant="ghost" size="sm">
              Marketplace
            </Button>
          </Link>
          <Link href="/login" className="trace-self-hosted-only">
            <Button variant="ghost" size="sm">
              Sign in
            </Button>
          </Link>
          <Link href="/register" className="trace-self-hosted-only">
            <Button size="sm">Get started</Button>
          </Link>
        </div>
      </nav>

      <section className="max-w-4xl mx-auto px-6 pt-20 pb-16 text-center">
        <div className="inline-flex items-center gap-2 bg-brand-100 text-brand-700 px-3 py-1 rounded-full text-sm font-medium mb-8">
          <span className="w-2 h-2 bg-brand-600 rounded-full"></span>
          EU Digital Product Passport compliant
        </div>
        <h1 className="text-5xl font-bold tracking-tight text-gray-900 mb-6">
          Construction materials deserve
          <span className="text-brand-600"> a second life</span>
        </h1>
        <p className="text-xl text-gray-600 max-w-2xl mx-auto mb-10">
          TRACE issues blockchain-anchored material passports for reclaimed construction materials,
          enabling circular economy hubs to buy and sell with trust and compliance.
        </p>
        <div className="flex items-center justify-center gap-4 flex-wrap">
          <Link href="/register" className="trace-self-hosted-only">
            <Button size="lg" className="bg-brand-600 hover:bg-brand-700">
              Create account
            </Button>
          </Link>
          <Link href="/marketplace">
            <Button variant="outline" size="lg" className="gap-2">
              <Store className="h-5 w-5" /> Browse marketplace
            </Button>
          </Link>
          <Link href="/scan">
            <Button variant="outline" size="lg" className="gap-2">
              <QrCode className="h-5 w-5" /> Scan QR code
            </Button>
          </Link>
        </div>
      </section>

      <section className="max-w-6xl mx-auto px-6 pb-24">
        <div className="grid md:grid-cols-3 gap-8">
          {[
            {
              Icon: ScrollText,
              title: 'EU DPP Compliant',
              desc: 'Every passport follows EU Digital Product Passport standards, ready for 2027 regulation.',
            },
            {
              Icon: ShieldCheck,
              title: 'Blockchain Anchored',
              desc: 'Integrity proofs on VeChainThor — anyone can verify a passport has not been tampered with.',
            },
            {
              Icon: Recycle,
              title: 'Circular Economy',
              desc: 'Track deconstruction origin, condition grades, carbon savings, and reuse history.',
            },
          ].map((f) => (
            <div
              key={f.title}
              className="bg-white rounded-xl border p-6 transition-shadow hover:shadow-md motion-safe:animate-fade-in-up"
            >
              <div className="mb-3 inline-flex h-11 w-11 items-center justify-center rounded-lg bg-brand-100 text-brand-700">
                <f.Icon className="h-6 w-6" />
              </div>
              <h3 className="font-semibold text-lg mb-2">{f.title}</h3>
              <p className="text-gray-500 text-sm">{f.desc}</p>
            </div>
          ))}
        </div>
      </section>
    </main>
  );
}
