import Link from "next/link";
import { NAV_ITEMS } from "../lib/nav";

export default function HomePage() {
  return (
    <section>
      <h1 className="text-3xl font-semibold">Story2Data</h1>
      <p className="mt-2 max-w-2xl text-gray-600 dark:text-gray-300">
        Z popisu firmy a příběhu vytvoří propojený dataset, ve kterém je příběh dohledatelný v samotných
        datech.
      </p>
      <ol className="mt-8 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {NAV_ITEMS.map((item, i) => (
          <li key={item.href}>
            <Link
              href={item.href}
              className="block h-full rounded-lg border border-black/10 p-4 hover:border-black/30 dark:border-white/10 dark:hover:border-white/30"
            >
              <span className="text-sm text-gray-500">{i + 1}.</span>{" "}
              <span className="font-medium">{item.label}</span>
              <p className="mt-1 text-sm text-gray-600 dark:text-gray-300">{item.description}</p>
            </Link>
          </li>
        ))}
      </ol>
    </section>
  );
}
