/** Chat layouts (components/chat/layouts.tsx). Plain module so server pages can read it. */
export const LAYOUTS = ["thread", "inspector", "split"] as const;
export type Layout = (typeof LAYOUTS)[number];

export const isLayout = (v: unknown): v is Layout => LAYOUTS.includes(v as Layout);
