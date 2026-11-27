/** NovaBella bud mark: hand-built SVG (no external image). Stroke follows currentColor. */
export function BrandMark({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 32 32" aria-hidden="true" focusable="false" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round">
      <path d="M16 29C8 25 5.5 14.5 16 3c10.5 11.5 8 22 0 26Z" />
      <path d="M16 29c-5-5-5.5-14 0-26" />
      <path d="M16 29c5-5 5.5-14 0-26" />
      <path d="M9 24.5c2.2.9 4.6 1.2 7 1.2s4.8-.3 7-1.2" opacity=".6" />
    </svg>
  );
}
