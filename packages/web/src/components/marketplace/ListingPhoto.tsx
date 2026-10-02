'use client';

import { useState } from 'react';
import { Leaf } from 'lucide-react';

/**
 * A listing card's picture: the product photo, or a neutral placeholder when
 * there is none or it fails to load.
 *
 * Never the passport's QR code. It used to fall back to one, which was
 * invisible while seeded passports had no QR, but once they got QR codes
 * (2026-09-28) every photo-less listing showed a QR as its "product image".
 * A broken photo also used to leave its alt text spilling over the card's
 * badges; now it falls back to the placeholder too.
 */
export function ListingPhoto({ src, alt }: { src: string | null | undefined; alt: string }) {
  const [failed, setFailed] = useState(false);

  if (!src || failed) {
    return (
      <div
        className="flex h-full items-center justify-center text-gray-300"
        role="img"
        aria-label={`${alt} (no photo)`}
      >
        <Leaf className="h-10 w-10" />
      </div>
    );
  }

  return (
    <img
      src={src}
      alt={alt}
      onError={() => setFailed(true)}
      className="h-full w-full object-cover transition-transform duration-300 motion-safe:group-hover:scale-105"
    />
  );
}
