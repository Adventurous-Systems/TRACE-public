'use client';

/**
 * Fire a small celebratory confetti burst (brand greens). Lazy-imports
 * canvas-confetti so it stays out of the main bundle, and respects
 * prefers-reduced-motion.
 */
export async function celebrate(): Promise<void> {
  if (typeof window === 'undefined') return;
  if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return;
  try {
    const confetti = (await import('canvas-confetti')).default;
    confetti({
      particleCount: 90,
      spread: 75,
      startVelocity: 38,
      origin: { y: 0.6 },
      colors: ['#16a34a', '#22c55e', '#15803d', '#dcfce7', '#86efac'],
      disableForReducedMotion: true,
    });
  } catch {
    /* confetti is non-essential — ignore load failures */
  }
}
