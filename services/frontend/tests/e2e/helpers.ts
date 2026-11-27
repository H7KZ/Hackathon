import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import type { Page } from "@playwright/test";

/** Screenshots for visual review land in <repo>/out/e2e-screens/<suite>/ (out/ is gitignored). */
export function screens(suite: string) {
  const dir = join(fileURLToPath(new URL("../../../../out/e2e-screens", import.meta.url)), suite);
  mkdirSync(dir, { recursive: true });
  let n = 0;
  return async (page: Page, name: string, fullPage = false) => {
    n += 1;
    await page.screenshot({ path: join(dir, `${String(n).padStart(2, "0")}-${name}.png`), fullPage });
  };
}

/** Collects uncaught page errors and console errors (React warnings, failed fetches). */
export function watchErrors(page: Page) {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));
  page.on("console", (m) => {
    if (m.type() === "error" && !/Download the React DevTools|favicon/.test(m.text()))
      errors.push(`console: ${m.text()}`);
  });
  return errors;
}
