import Link from "next/link";
import { NAV_ITEMS } from "../lib/nav";

export function Nav({ active }: { active?: string }) {
  return (
    <nav aria-label="Hlavní navigace" className="flex flex-wrap gap-1">
      <Link href="/" className="mr-4 font-semibold">
        Story2Data
      </Link>
      {NAV_ITEMS.map((item) => (
        <Link
          key={item.href}
          href={item.href}
          aria-current={active === item.href ? "page" : undefined}
          className="rounded px-3 py-1 text-sm hover:bg-black/5 aria-[current=page]:bg-black/10 dark:hover:bg-white/10"
        >
          {item.label}
        </Link>
      ))}
    </nav>
  );
}
