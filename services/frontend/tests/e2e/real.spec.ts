import { expect, test } from "@playwright/test";
import { screens, watchErrors } from "./helpers";

/**
 * The real stack in a browser: real cascade, engine, DuckDB, detective (E2E_REAL=1).
 * With LLM_OFFLINE=1 it replays the recorded LLM cache (`pnpm demo`-like); without it, it calls the
 * paid model. E2E_CASE picks the prompt; the default is the "Dodavatel" example.
 * Screenshots: out/e2e-screens/real-<case>/.
 */
const company = process.env.E2E_COMPANY ?? "E-shop s domácími spotřebiči";
const story =
  process.env.E2E_STORY ??
  "Dodavatel začal v březnu zpožďovat dodávky. Zákazníci si stěžují a část z nich ruší objednávky.";
const shot = screens(`real-${process.env.E2E_CASE ?? "dodavatel"}`);
const WHAT_IF = "Co kdyby byl dopad poloviční?";

test("real pipeline in the browser: story → data → detective → what-if", async ({ page }) => {
  const errors = watchErrors(page);
  await page.goto("/");
  await page.getByLabel("Firma").fill(company);
  await page.getByLabel(/Příběh/).fill(story);
  await page.getByRole("button", { name: "Odeslat", exact: true }).click();
  await expect(page).toHaveURL(/\/chat\?s=/);

  const editor = page.getByRole("region", { name: "Návrh příběhu" });
  await expect(page.getByText("Návrh příběhu je připravený")).toBeVisible();
  await expect(page.getByText("Firma", { exact: true }).first()).toBeVisible();
  await shot(page, "story-editor");
  await editor.getByRole("button", { name: "Generovat data" }).click();

  const dataset = page.getByRole("region", { name: "Dataset d1" });
  await expect(dataset).toBeVisible();
  await expect(dataset.locator(".recharts-line").first()).toBeVisible();
  await shot(page, "dataset-overview");
  await dataset.getByRole("tab", { name: "Důkazy" }).click();
  await shot(page, "dataset-evidence");
  await dataset.getByRole("tab", { name: "Tabulky" }).click();
  await expect(dataset.getByText(/řádků \(ukázka prvních/).first()).toBeVisible();
  await shot(page, "dataset-tables");

  await page.getByRole("button", { name: "Spustit detektiva" }).click();
  await expect(page.getByRole("region", { name: /Slepý detektiv/ })).toBeVisible();
  await expect(page.getByText(/Detektiv data neznal a našel \d+ %/)).toBeVisible();
  await shot(page, "detective");

  await page.getByRole("button", { name: WHAT_IF }).click();
  await expect(page.getByRole("region", { name: /Porovnání d1 ↔ d2/ })).toBeVisible();
  await shot(page, "compare");
  await shot(page, "full-thread", true);
  expect(errors.filter((e) => !/EventSource|ERR_INCOMPLETE_CHUNKED/.test(e))).toEqual([]);
});
