"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

export interface NavLink {
  readonly href: string;
  readonly label: string;
  /** Pending-work counter shown next to the label (e.g. new web orders). */
  readonly badge?: number;
}

export function NavLinks({ items }: { items: readonly NavLink[] }) {
  const pathname = usePathname();
  return (
    <nav className="nav" aria-label="Principal">
      {items.map((item) => {
        const current = pathname === item.href || pathname.startsWith(`${item.href}/`);
        return (
          <Link key={item.href} href={item.href} aria-current={current ? "page" : undefined}>
            {item.label}
            {item.badge ? (
              <span className="nav__badge num" aria-label={`${item.badge} pendientes`}>
                {item.badge}
              </span>
            ) : null}
          </Link>
        );
      })}
    </nav>
  );
}
