import { expect, test, type Page } from "@playwright/test";
import { screens, watchErrors } from "./helpers";

/**
 * The whole workflow over the real API process with fake services (API_FAKE=all, 400 ms per step):
 * story → agents → timeline → Generovat data → dataset (chart, evidence, tables) → detective →
 * "Co kdyby" → comparison. Plus cancel → resume. Screenshots: out/e2e-screens/flow/.
 */
const shot = screens("flow");

async function startStory(page: Page) {
  await page.goto("/");
  await page.getByRole("button", { name: "Příklad: Dodavatel" }).click();
  const created = page.waitForResponse(
    (r) => r.url().endsWith("/sessions") && r.request().method() === "POST",
  );
  await page.getByRole("button", { name: "Odeslat", exact: true }).click();
  expect((await created).status()).toBe(201);
}

test("story → timeline → data → detective → what-if → comparison", async ({ page }) => {
  const errors = watchErrors(page);
  await startStory(page);
  await expect(page).toHaveURL(/\/chat\?s=/);
  await expect(page.getByText("Agenti navrhují příběh")).toBeVisible();
  await shot(page, "drafting");

  const story = page.getByRole("region", { name: "Návrh příběhu" });
  await expect(page.getByText("Návrh příběhu je připravený")).toBeVisible();
  await expect(story.getByRole("button", { name: "Generovat data" })).toBeEnabled();
  // live mode: only settings the API applies are offered
  await story.getByText("Pokročilé nastavení").click();
  await expect(story.getByText("Šum v datech")).toBeVisible();
  await expect(story.getByText("Velikost firmy", { exact: true })).toHaveCount(0);
  await shot(page, "story-editor", true);

  const approve = page.waitForRequest(
    (r) => r.url().endsWith("/commands") && (r.postData() ?? "").includes('"approve"'),
  );
  await story.getByRole("button", { name: "Generovat data" }).click();
  const body = JSON.parse((await approve).postData() ?? "{}") as { settings?: { seed?: number } };
  expect(body.settings?.seed).toBe(42);
  await expect(page.getByText("Generování dat")).toBeVisible();

  const dataset = page.getByRole("region", { name: "Dataset dat1" });
  await expect(dataset).toBeVisible();
  await expect(dataset.getByText("Důkazy splněny")).toBeVisible();
  await expect(dataset.getByText("Řádků")).toBeVisible();
  await expect(dataset.locator(".recharts-surface").first()).toBeVisible();
  await shot(page, "dataset-overview");
  await dataset.getByRole("tab", { name: "Důkazy" }).click();
  await expect(dataset.getByText("✓ splněno").first()).toBeVisible();
  await dataset.getByRole("tab", { name: "Tabulky" }).click();
  await expect(dataset.getByText(/objednavky · 1\s200 řádků/)).toBeVisible();
  await shot(page, "dataset-tables");

  await page.getByRole("button", { name: "Spustit detektiva" }).click();
  await expect(page.getByText(/Detektiv data neznal a našel 100 %/)).toBeVisible();
  await expect(page.getByRole("region", { name: /Slepý detektiv/ })).toBeVisible();
  await shot(page, "detective");

  await page.getByRole("button", { name: "Co kdyby byl dopad poloviční?" }).click();
  // the comparison is a tab of the what-if dataset, not its own panel
  const compare = page.getByRole("region", { name: "Dataset dat2" });
  await expect(compare).toBeVisible();
  await compare.getByRole("tab", { name: "Porovnání s dat1" }).click();
  await expect(compare.getByText("objednavky.count")).toBeVisible();
  await expect(page.getByText(/Hotovo: \*?\*?dat2|Hotovo: dat2/)).toBeVisible();
  await shot(page, "compare");
  await shot(page, "full-thread", true);

  // reload: the thread is rebuilt from the SSE replay, without duplicates
  await page.reload();
  await expect(page.getByRole("region", { name: "Dataset dat2" })).toBeVisible();
  await expect(page.getByRole("region", { name: "Dataset dat1" })).toHaveCount(1);
  // user: after a reload the cards must keep the timeline order (Firma above the generation card)
  const firmaY = (await page.getByText("Firma", { exact: true }).first().boundingBox())?.y ?? 0;
  const genY =
    (
      await page
        .getByText(/Generování dat/)
        .first()
        .boundingBox()
    )?.y ?? 0;
  expect(firmaY).toBeLessThan(genY);
  expect(errors).toEqual([]);
});

test("cancel while drafting, then resume", async ({ page }) => {
  const errors = watchErrors(page);
  await startStory(page);
  await page.getByRole("button", { name: "Zrušit" }).click();
  const card = page.getByText("Návrh byl zrušen. Můžu v něm pokračovat.");
  await expect(card).toBeVisible();
  await shot(page, "cancelled");
  await page.getByRole("button", { name: "Pokračovat" }).click();
  await expect(page.getByText("Návrh příběhu je připravený")).toBeVisible();
  expect(errors).toEqual([]);
});
