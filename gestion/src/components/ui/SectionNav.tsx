"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

export interface SectionTab {
  readonly href: string;
  readonly label: string;
  /** RegExp source of extra paths that also mark this tab as current (detail pages). */
  readonly also?: string;
  /** Match only the exact href (the section's index). */
  readonly exact?: boolean;
}

/** Tab strip under the main navigation: Compras, Ventas... same look as the catalog's. */
export function SectionNav({ tabs, label }: { tabs: readonly SectionTab[]; label: string }) {
  const pathname = usePathname();
  return (
    <nav className="subnav" aria-label={label}>
      {tabs.map((tab) => {
        const starts = (prefix: string) => pathname === prefix || pathname.startsWith(`${prefix}/`);
        const alsoMatches = tab.also ? new RegExp(tab.also).test(pathname) : false;
        const current = tab.exact ? pathname === tab.href || alsoMatches : starts(tab.href) || alsoMatches;
        return (
          <Link key={tab.href} href={tab.href} aria-current={current ? "page" : undefined}>
            {tab.label}
          </Link>
        );
      })}
    </nav>
  );
}
