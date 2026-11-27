/** UI pages (SPEC §3.G). User-facing text is Czech. */
export const NAV_ITEMS = [
  { href: "/pribeh", label: "Příběh", description: "Zadání firmy a příběhu, spuštění kaskády A1–A5." },
  { href: "/scenar", label: "Scénář", description: "Editor scénáře a křivek story pointů." },
  { href: "/data", label: "Data", description: "Prohlížeč tabulek, ERD, export." },
  { href: "/dukaz", label: "Důkaz", description: "Expectations a grafy nad vygenerovanými daty." },
  { href: "/detektiv", label: "Detektiv", description: "Slepý LLM detektiv nad schématem main." },
  { href: "/porovnani", label: "Porovnání", description: "Běh A vs. běh B po změně parametru." },
] as const;

export type NavItem = (typeof NAV_ITEMS)[number];
