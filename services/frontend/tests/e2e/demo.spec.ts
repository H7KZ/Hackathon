import { expect, test } from "@playwright/test";
import { screens, watchErrors } from "./helpers";

/**
 * Demo data (docs/demo-data.md): every recorded case replays in the browser without the API —
 * picker → story (fixed) → Generovat data → dataset with real tables → detective → prepared what-if →
 * comparison; an unprepared question is refused. Screenshots of every panel: out/e2e-screens/demo-<case>/.
 */
const CASES = [
  { id: "eshop_carrier", title: "E-shop: dopravce nestíhá", rows: "36 042" },
  { id: "isp_firmware", title: "Internet: aktualizace shodí routery", rows: "41 506" },
  { id: "card_fraud", title: "Banka: vlna zneužitých karet", rows: "45 145" },
];

test("picker lists every recorded case and links to it", async ({ page }) => {
  const errors = watchErrors(page);
  const shot = screens("demo-picker");
  await page.goto("/chat?demo=1");
  await expect(page.getByRole("heading", { name: "Ukázky s demo daty" })).toBeVisible();
  for (const c of CASES) await expect(page.getByRole("heading", { name: c.title })).toBeVisible();
  await expect(page.getByRole("link", { name: "Přehrát ukázku" })).toHaveCount(CASES.length);
  const xlsx = await page.request.get(`/demo/${CASES[0]?.id ?? ""}/${CASES[0]?.id ?? ""}_dat1.xlsx`);
  expect(xlsx.status()).toBe(200);
  expect((await xlsx.body()).length).toBeGreaterThan(500_000);
  await shot(page, "picker", true);
  await page.getByRole("link", { name: "Přehrát ukázku" }).first().click();
  await expect(page).toHaveURL(/\/chat\?demo=[a-z_]+$/);
  expect(errors).toEqual([]);
});

for (const c of CASES) {
  test(`replays ${c.id}: data → detective → what-if`, async ({ page }) => {
    const errors = watchErrors(page);
    const shot = screens(`demo-${c.id}`);
    await page.goto(`/chat?demo=${c.id}`);
    await expect(page.getByText("Demo data")).toBeVisible();
    await expect(page.getByRole("combobox")).toHaveValue(c.id);

    const story = page.getByRole("region", { name: "Návrh příběhu" });
    await expect(page.getByText("Návrh příběhu je připravený")).toBeVisible({ timeout: 30_000 });
    // fixed story: no settings that would change the recorded data
    await expect(story.getByText("Pokročilé nastavení")).toHaveCount(0);
    await shot(page, "story", true);
    await story.getByRole("button", { name: "Generovat data" }).click();

    const dat1 = page.getByRole("region", { name: "Dataset dat1" });
    await expect(dat1).toBeVisible({ timeout: 30_000 });
    await expect(dat1.getByText(c.rows)).toBeVisible();
    await expect(dat1.getByText("7 / 7")).toBeVisible();
    await expect(dat1.getByRole("button", { name: "Excel (.xlsx)" })).toBeVisible();
    await dat1.scrollIntoViewIfNeeded();
    await shot(page, "dataset-overview");
    for (const tab of ["Důkazy", "Tabulky"]) {
      await dat1.getByRole("tab", { name: tab }).click();
      await shot(page, `dataset-${tab}`);
    }

    await page.getByRole("button", { name: "Spustit detektiva" }).click();
    await expect(page.getByText(/Detektiv data neznal a našel \d+ % bodů příběhu/)).toBeVisible({
      timeout: 30_000,
    });
    await page.getByRole("region", { name: "Slepý detektiv · dat1" }).scrollIntoViewIfNeeded();
    await shot(page, "detective");

    const composer = page.getByRole("textbox");
    await composer.fill("Co kdyby pršelo?");
    await composer.press("Enter");
    await expect(page.getByText(/V ukázce jsou připravené jen otázky/)).toBeVisible();

    const offered = page.getByRole("button", { name: /^Co kdyby/ }).first();
    const question = (await offered.textContent()) ?? "";
    await offered.click();
    const dat2 = page.getByRole("region", { name: "Dataset dat2" });
    await expect(dat2).toBeVisible({ timeout: 30_000 });
    await dat2.getByRole("tab", { name: "Porovnání s dat1" }).click();
    await expect(dat2.getByText(question)).toBeVisible();
    await shot(page, "what-if-compare");
    await shot(page, "full-thread", true);
    expect(errors).toEqual([]);
  });
}
