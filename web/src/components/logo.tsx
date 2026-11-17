import { useId } from "react";
import { cn } from "@/lib/utils";

/** Bubble mark: three interlocking bubbles. The gap stroke follows the page background. */
export function Logo({ className, title = "Ultimate Agent Builder" }: { className?: string; title?: string }) {
  const id = useId();
  const rose = `${id}-rose`;
  const ocean = `${id}-ocean`;
  return (
    <svg viewBox="200 206 624 610" role="img" aria-label={title} className={cn("size-8", className)}>
      <defs>
        <clipPath id={rose}><circle cx="512" cy="416" r="198" /></clipPath>
        <clipPath id={ocean}><circle cx="613" cy="605" r="198" /></clipPath>
      </defs>
      <circle cx="408" cy="606" r="196" fill="#CDB5F5" />
      <circle cx="613" cy="605" r="198" fill="#93D1FB" />
      <circle cx="512" cy="416" r="198" fill="#FFAAB0" />
      <g clipPath={`url(#${rose})`}>
        <circle cx="408" cy="606" r="196" fill="#CDB5F5" stroke="var(--background)" strokeWidth="44" />
        <g clipPath={`url(#${ocean})`}>
          <circle cx="408" cy="606" r="196" fill="#C4A0FA" />
        </g>
      </g>
      <g clipPath={`url(#${ocean})`}>
        <circle cx="512" cy="416" r="209" fill="none" stroke="#6FB8F5" strokeWidth="22" />
      </g>
    </svg>
  );
}
