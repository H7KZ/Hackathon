import { NAV_ITEMS } from "../lib/nav";

/** Temporary page body until the real screen is built. */
export function PagePlaceholder({ href }: { href: (typeof NAV_ITEMS)[number]["href"] }) {
  const item = NAV_ITEMS.find((i) => i.href === href);
  return (
    <section>
      <h1 className="text-2xl font-semibold">{item?.label}</h1>
      <p className="mt-2 text-gray-600 dark:text-gray-300">{item?.description}</p>
      <p className="mt-6 text-sm text-gray-500">Zatím neimplementováno.</p>
    </section>
  );
}
