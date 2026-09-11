interface LogoProps {
  /** Tailwind height class (width auto-scales). Defaults to `h-7`. */
  className?: string;
}

/**
 * TRACE wordmark — horizontal lockup for header/nav use on light backgrounds.
 * For the full ringed brand mark (auth / scan hero) use `/trace-logo.png`
 * (or `/trace-logo-white.png` on dark backgrounds) directly.
 */
export function Logo({ className = 'h-7' }: LogoProps) {
  return <img src="/trace-wordmark.png" alt="TRACE" className={`w-auto ${className}`} />;
}
