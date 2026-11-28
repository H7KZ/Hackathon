"use client";

import { useState, useSyncExternalStore } from "react";

export const YOYO_VARIANTS = [
  "/yoyo-spinner-kid.svg",
  "/yoyo-spinner-pull.svg",
  "/yoyo-spinner-skill.svg",
] as const;

const pick = (): string =>
  YOYO_VARIANTS[Math.floor(Math.random() * YOYO_VARIANTS.length)] ?? YOYO_VARIANTS[0];
const noopSubscribe = (): (() => void) => () => {};
const isClient = (): boolean => true;
const isServer = (): boolean => false;

/** Shared loading indicator: one of three animated yoyo SVGs, chosen once per mount. */
export function YoyoSpinner({
  size = 40,
  label = "Načítání…",
  className,
}: {
  size?: number;
  label?: string;
  className?: string | undefined;
}) {
  // random pick once per mount; the server and the hydration render show a fixed variant (no mismatch)
  const [random] = useState(pick);
  const hydrated = useSyncExternalStore(noopSubscribe, isClient, isServer);
  const src = hydrated ? random : YOYO_VARIANTS[0];
  return (
    <span role="status" className={["yoyo-spinner", className].filter(Boolean).join(" ")}>
      <img src={src} width={size} height={size} alt="" aria-hidden="true" />
      <span className="sr-only">{label}</span>
    </span>
  );
}
